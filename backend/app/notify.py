"""Email alerts for upload failures + a daily summary.

Pure stdlib (smtplib + email.message) — no new dependency. Everything is
best-effort and degrades to a no-op when SMTP isn't configured, so a dev box
or a server without mail credentials runs the full pipeline without errors.

Env knobs:
  SMTP_HOST           default smtp.gmail.com
  SMTP_PORT           default 587 (STARTTLS)
  SMTP_USER           account to authenticate as  (unset → all email is no-op)
  SMTP_PASSWORD       app password                (unset → all email is no-op)
  ALERT_EMAIL_TO      recipient (default: SMTP_USER)
  ALERT_EMAIL_FROM    sender    (default: SMTP_USER)
  PUBLIC_BASE         used to build the /admin link in the email body
"""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import Any


def smtp_configured() -> bool:
    """True only when we have enough to actually send mail."""
    return bool(os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"))


def _admin_url() -> str:
    base = (os.getenv("PUBLIC_BASE") or "").rstrip("/")
    return f"{base}/admin" if base else "/admin"


def send_email(subject: str, body: str) -> bool:
    """Send a plain-text email. Returns True if sent, False if skipped/failed.

    Never raises — callers are on hot paths (the analysis failure handler) and
    a mail problem must not bubble up and mask the original error.
    """
    if not smtp_configured():
        print(f"[notify] SMTP not configured — skipping email: {subject!r}")
        return False

    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASSWORD", "")
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    to_addr = os.getenv("ALERT_EMAIL_TO") or user
    from_addr = os.getenv("ALERT_EMAIL_FROM") or user

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=20) as server:
            server.starttls(context=ssl.create_default_context())
            server.login(user, password)
            server.send_message(msg)
        print(f"[notify] sent email to {to_addr}: {subject!r}")
        return True
    except Exception as exc:  # network / auth / etc. — log and move on
        print(f"[notify] email send failed ({type(exc).__name__}): {exc!r}")
        return False


def notify_upload_failure(event: dict[str, Any]) -> None:
    """Email the maintainer that an upload failed mid-analysis.

    `event` is a dict shaped like an upload_events row (filename, error_type,
    error_stage, error_message, paper_id, created_at).
    """
    filename = event.get("filename") or "(unknown file)"
    subject = f"[論文檢核] 上傳分析失敗：{filename}"
    body = (
        "一篇論文上傳後分析失敗。\n\n"
        f"檔名：{filename}\n"
        f"大小：{event.get('file_size') or '?'} bytes\n"
        f"paper_id：{event.get('paper_id') or '-'}\n"
        f"失敗階段：{event.get('error_stage') or '-'}\n"
        f"錯誤類型：{event.get('error_type') or '-'}\n"
        f"錯誤訊息：{event.get('error_message') or '-'}\n"
        f"上傳時間：{event.get('created_at') or '-'}\n\n"
        f"到後台查看 / 下載原始檔重現：{_admin_url()}\n"
    )
    send_email(subject, body)


def send_daily_summary(stats: dict[str, Any], window_label: str) -> None:
    """Email a digest of the last window's uploads. No-op if nothing happened."""
    if stats.get("total", 0) == 0:
        print("[notify] daily summary: no uploads in window — skipping email")
        return

    by = stats.get("by_status", {})
    lines = [
        f"過去 {window_label} 的上傳摘要：\n",
        f"總上傳：{stats['total']}",
        f"  成功 (done)：{by.get('done', 0)}",
        f"  快取命中 (cached)：{by.get('cached', 0)}",
        f"  失敗 (error)：{by.get('error', 0)}",
        f"  進行中/未完成 (pending)：{by.get('pending', 0)}",
    ]
    failures = stats.get("failures", [])
    if failures:
        lines.append("\n失敗清單：")
        for f in failures:
            lines.append(
                f"  • {f.get('filename') or '(unknown)'} "
                f"[{f.get('error_stage') or '-'}/{f.get('error_type') or '-'}] "
                f"{f.get('created_at') or ''}"
            )
    lines.append(f"\n後台：{_admin_url()}\n")
    send_email(
        f"[論文檢核] 每日上傳摘要（失敗 {by.get('error', 0)} / 共 {stats['total']}）",
        "\n".join(lines),
    )
