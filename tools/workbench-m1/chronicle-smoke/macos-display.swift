import AppKit
import CoreGraphics
import Darwin

let display = CGMainDisplayID()
let modes = CGDisplayCopyAllDisplayModes(display, nil) as? [CGDisplayMode] ?? []
let sizes = Set(modes.map { "\($0.width)x\($0.height)" }).sorted()
print("CHRONICLE_MAC_DISPLAY_MODES \(sizes)")

if CommandLine.arguments.contains("--wide") {
    guard let mode = modes.first(where: { $0.width == 1600 && $0.height == 1200 }) else {
        print("The hosted display has no 1600x1200 mode")
        exit(1)
    }

    var configuration: CGDisplayConfigRef?
    let began = CGBeginDisplayConfiguration(&configuration)
    guard began == .success else {
        print("Display configuration could not begin: \(began.rawValue)")
        exit(1)
    }
    let configured = CGConfigureDisplayWithDisplayMode(configuration, display, mode, nil)
    guard configured == .success else {
        CGCancelDisplayConfiguration(configuration)
        print("The hosted display could not select 1600x1200: \(configured.rawValue)")
        exit(1)
    }
    let applied = CGCompleteDisplayConfiguration(configuration, .forSession)
    guard applied == .success,
          CGDisplayCopyDisplayMode(display)?.width == 1600,
          CGDisplayCopyDisplayMode(display)?.height == 1200 else {
        print("The hosted display did not switch to 1600x1200: \(applied.rawValue)")
        exit(1)
    }
}

print("CHRONICLE_MAC_VISIBLE_FRAMES \(NSScreen.screens.map { $0.visibleFrame })")
