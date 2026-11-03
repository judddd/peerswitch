import Foundation
import IOKit
import IOKit.i2c
import CoreGraphics

// Minimal DDC/CI Input Select (VCP 0x60) helper for Orbit.
// Usage: OrbitDDC set <code>   e.g. OrbitDDC set 0x11

func packDDC(vcp: UInt8, value: UInt16) -> [UInt8] {
  let hi = UInt8((value >> 8) & 0xff)
  let lo = UInt8(value & 0xff)
  // DDC/CI Set VCP Feature
  var data: [UInt8] = [0x51, 0x84, 0x03, vcp, hi, lo]
  var checksum: UInt8 = 0x6e ^ 0x51
  for b in data.dropFirst() { checksum ^= b }
  data.append(checksum)
  return data
}

func writeDDC(framebuffer: io_service_t, code: UInt16) -> Bool {
  var interfaces: io_service_t = 0
  var iterator: io_iterator_t = 0
  let matching = IOServiceMatching("IOFramebufferI2CInterface")
  guard IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) == KERN_SUCCESS else {
    return false
  }
  defer { IOObjectRelease(iterator) }

  var ok = false
  while true {
    interfaces = IOIteratorNext(iterator)
    if interfaces == 0 { break }
    defer { IOObjectRelease(interfaces) }

    var connect: io_connect_t = 0
    guard IOFBGetI2CInterface(interfaces, 0, &connect) == KERN_SUCCESS else { continue }
    defer { IOServiceClose(connect) }

    var request = IOI2CRequest()
    request.commFlags = 0
    request.sendAddress = 0x6e
    request.sendTransactionType = UInt32(kIOI2CSimpleTransactionType)
    let payload = packDDC(vcp: 0x60, value: code)
    payload.withUnsafeBufferPointer { buf in
      request.sendBuffer = UInt64(UInt(bitPattern: buf.baseAddress))
      request.sendBytes = UInt32(buf.count)
      var req = request
      let result = IOFBI2CRequest(connect, 0, nil, &req)
      if result == KERN_SUCCESS { ok = true }
    }
  }
  return ok
}

// Soft fallback path using CGDisplay / private symbols is fragile;
// Prefer bundled m1ddc when available. This binary attempts IOKit I2C.

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "set", let value = UInt16(args[2].dropFirst(args[2].hasPrefix("0x") ? 2 : 0), radix: args[2].hasPrefix("0x") ? 16 : 10) else {
  fputs("Usage: OrbitDDC set <inputCode>\n", stderr)
  exit(2)
}

// Iterate online displays — actual I2C mapping varies by GPU; success is best-effort.
var displayCount: UInt32 = 0
CGGetActiveDisplayList(0, nil, &displayCount)
var displays = [CGDirectDisplayID](repeating: 0, count: Int(displayCount))
CGGetActiveDisplayList(displayCount, &displays, &displayCount)

var any = false
for _ in displays {
  // Probe framebuffer services globally once
  if writeDDC(framebuffer: 0, code: value) {
    any = true
    break
  }
}

if any {
  print("ok \(value)")
  exit(0)
} else {
  fputs("OrbitDDC: DDC write did not succeed. Install m1ddc for Apple Silicon.\n", stderr)
  exit(1)
}
