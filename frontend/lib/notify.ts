// Browser notification helpers. OS-level notifications require a secure context
// (HTTPS or localhost); on a plain-http deployment they silently no-op and the
// caller's tab-title / toast fallback carries the signal instead.

const NOTIFY_PREF_KEY = "paperchecker:notify";

export function canSystemNotify(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.isSecureContext
  );
}

export function getNotifyPref(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(NOTIFY_PREF_KEY) === "on";
}

function setNotifyPref(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NOTIFY_PREF_KEY, on ? "on" : "off");
}

// Ask for permission on a user gesture (e.g. clicking "開始分析"). Records the
// outcome so we don't re-prompt every time.
export async function requestNotifyPermission(): Promise<void> {
  if (!canSystemNotify()) return;
  if (Notification.permission === "granted") {
    setNotifyPref(true);
    return;
  }
  if (Notification.permission === "denied") {
    setNotifyPref(false);
    return;
  }
  try {
    const res = await Notification.requestPermission();
    setNotifyPref(res === "granted");
  } catch {
    // Some browsers throw on the deprecated callback form — ignore.
  }
}

export function fireDoneNotification(opts: {
  title: string;
  defectCount: number | null;
  onOpen: () => void;
}): void {
  if (!canSystemNotify() || Notification.permission !== "granted") return;
  try {
    // OS-level notification — kept in English regardless of UI locale (it can
    // fire while the user is in another app, where the in-app locale is moot).
    const body =
      opts.defectCount != null
        ? `"${opts.title}" analyzed — ${opts.defectCount} defects`
        : `"${opts.title}" analyzed`;
    const n = new Notification("Analysis complete", {
      body,
      icon: "/icon.svg",
      tag: "paperchecker-done",
    });
    n.onclick = () => {
      window.focus();
      opts.onOpen();
      n.close();
    };
  } catch {
    // Construction can throw in odd environments — fallback handles the signal.
  }
}
