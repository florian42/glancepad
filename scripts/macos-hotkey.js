// Sends one tap of a hotkey on macOS, as the keyboard would.
//
//   osascript -l JavaScript scripts/macos-hotkey.js <key code> [cmd] [ctrl] [opt] [shift]
//
// The event goes to the HID event tap. Raycast ignores a hotkey that
// System Events sends (`tell application "System Events" to key code`),
// but it accepts this one. Tested on macOS 26.5 with Raycast Dictation.
// The terminal application that runs it needs the Accessibility permission.

ObjC.import("CoreGraphics");

// Each modifier: its flag and the key code of its left key.
const MODIFIERS = {
  cmd: { mask: $.kCGEventFlagMaskCommand, key: 55 },
  shift: { mask: $.kCGEventFlagMaskShift, key: 56 },
  opt: { mask: $.kCGEventFlagMaskAlternate, key: 58 },
  ctrl: { mask: $.kCGEventFlagMaskControl, key: 59 },
};

function post(keyCode, down, flags) {
  const event = $.CGEventCreateKeyboardEvent($(), keyCode, down);
  $.CGEventSetFlags(event, flags);
  $.CGEventPost($.kCGHIDEventTap, event);
  delay(0.01);
}

// biome-ignore lint/correctness/noUnusedVariables: osascript calls run().
function run(argv) {
  const keyCode = Number(argv[0]);
  if (!Number.isInteger(keyCode))
    throw new Error("usage: <key code> [cmd] [ctrl] [opt] [shift]");
  const modifiers = argv.slice(1).map((name) => {
    if (!(name in MODIFIERS)) throw new Error(`unknown modifier: ${name}`);
    return MODIFIERS[name];
  });
  // Press and release each modifier as a key. A key event with flags
  // only leaves the modifiers held at the HID level, and the next key
  // that the user types then gets them too.
  let flags = 0;
  for (const modifier of modifiers) {
    flags |= modifier.mask;
    post(modifier.key, true, flags);
  }
  post(keyCode, true, flags);
  delay(0.04);
  post(keyCode, false, flags);
  for (const modifier of [...modifiers].reverse()) {
    flags &= ~modifier.mask;
    post(modifier.key, false, flags);
  }
}
