/**
 * Whether daemon mode is worth offering in this runtime at all.
 *
 * A `bookmarks-but-better` daemon is a native background process on the *same machine* the
 * browser runs on. Firefox for Android — the only mobile browser with any
 * extension support — cannot run one, has no loopback service to reach even
 * if one existed elsewhere, and cannot request a filesystem-facing native
 * permission the way a desktop OS can. Showing a "Connect to a daemon" UI
 * there would be a dead end dressed up as a feature, so it is hidden rather
 * than left to fail with a confusing error every time.
 */
export function isDaemonModeSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.userAgent) return true
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
