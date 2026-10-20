// Reads the text of a Superfit plan PDF (first page) with Apple Vision.
//
// Usage: ocr <plan.pdf> [--crop x,y,w,h ...] [--scale N] [--orientation up|down] [--png out.png]
//   --crop         region in PDF points of the upright page, origin top-left;
//                  may be repeated, each region is read on its own
//   --scale        render resolution (default 4 = four times the page size)
//   --orientation  how to hand the image to Vision; default: try down, then up
// Prints JSON: {"width", "height", "orientation", "boxes": [{"text", "x", "y", "w", "h", "conf", "region"}]}
// ("region" = index of the --crop, 0 for the whole page) and, for the whole
// page (no --crop), "textTimes": the time ranges in the PDF's own text.
// Box coordinates are in PDF points of the upright page, origin top-left, so
// results of different crops and scales can be compared directly.
//
// Vision does not always read the rendered bitmap the right way up (on macOS 27
// it reads it turned by 180 degrees). The orientation is therefore probed: the
// first one in which several weekday headers are readable wins, and boxes read
// with .down are turned back so the output is always upright.
import AppKit
import Foundation
import PDFKit
import Vision

struct Options {
    var pdf = ""
    var crops: [CGRect] = []
    var scale: CGFloat = 4
    var orientation: String? = nil
    var png: String? = nil
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

func parseOptions(_ args: [String]) -> Options {
    var opts = Options()
    var i = 1
    while i < args.count {
        let arg = args[i]
        let value = i + 1 < args.count ? args[i + 1] : ""
        switch arg {
        case "--crop":
            let n = value.split(separator: ",").compactMap { Double($0) }
            guard n.count == 4 else { fail("--crop needs x,y,w,h") }
            opts.crops.append(CGRect(x: n[0], y: n[1], width: n[2], height: n[3]))
        case "--scale": opts.scale = CGFloat(Double(value) ?? 4)
        case "--orientation": opts.orientation = value
        case "--png": opts.png = value
        default: opts.pdf = arg; i -= 1
        }
        i += 2
    }
    if opts.pdf.isEmpty { fail("usage: ocr <plan.pdf> [--crop x,y,w,h] [--scale N] [--orientation up|down]") }
    return opts
}

/// The document is returned too: a page must not outlive its document.
func loadPage(_ path: String) -> (PDFDocument, PDFPage) {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)), let page = doc.page(at: 0) else {
        fail("cannot open PDF: \(path)")
    }
    return (doc, page)
}

/// Upright page size in points (page.draw applies the page's /Rotate).
func pageSize(_ page: PDFPage) -> CGSize {
    let box = page.bounds(for: .mediaBox)
    return page.rotation % 180 != 0 ? CGSize(width: box.height, height: box.width) : box.size
}

func render(_ page: PDFPage, region: CGRect, scale: CGFloat) -> CGImage {
    let size = pageSize(page)
    let width = Int(region.width * scale), height = Int(region.height * scale)
    guard let ctx = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { fail("cannot create bitmap") }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    ctx.scaleBy(x: scale, y: scale)
    // CoreGraphics counts y from the bottom; the region counts from the top.
    ctx.translateBy(x: -region.minX, y: -(size.height - region.maxY))
    page.draw(with: .mediaBox, to: ctx)
    guard let image = ctx.makeImage() else { fail("cannot render page") }
    return image
}

func recognize(_ image: CGImage, _ orientation: CGImagePropertyOrientation) -> [VNRecognizedTextObservation] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["de-DE", "en-US"]
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    do { try handler.perform([request]) } catch { fail("vision failed: \(error)") }
    return request.results ?? []
}

let weekdays: Set<String> = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG", "SONNTAG"]

func weekdayCount(_ found: [VNRecognizedTextObservation]) -> Int {
    found.filter { weekdays.contains($0.topCandidates(1).first?.string.uppercased() ?? "") }.count
}

let orientations: [String: CGImagePropertyOrientation] = ["down": .down, "up": .up]

func readImage(_ image: CGImage, _ wanted: String?) -> (String, [VNRecognizedTextObservation]) {
    if let wanted = wanted {
        guard let o = orientations[wanted] else { fail("unknown orientation: \(wanted)") }
        return (wanted, recognize(image, o))
    }
    for name in ["down", "up"] {
        let found = recognize(image, orientations[name]!)
        if weekdayCount(found) >= 3 { return (name, found) }
    }
    fail("no readable weekday header in any orientation")
}

func savePNG(_ image: CGImage, to path: String) {
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else { return }
    try? data.write(to: URL(fileURLWithPath: path))
}

func rounded(_ v: CGFloat) -> Double { (Double(v) * 10).rounded() / 10 }

/// Every time range ("18:00 - 18:20") in the PDF's real text (the times are
/// text, the course names are pictures), each with its own position, in the
/// same upright top-left coordinates as the boxes. Exact where Vision can
/// misread, e.g. when a cell's time is partly covered. Matched one by one,
/// not per line, because PDFKit joins equal times of neighbouring days into
/// one line. Only unrotated pages are handled; otherwise the list is empty.
let timeRange = try! NSRegularExpression(pattern: "\\d{1,2}[:.]\\d{2}\\s*[-–]\\s*\\d{1,2}[:.]\\d{2}")

func textLayerTimes(_ page: PDFPage) -> [[String: Any]] {
    let media = page.bounds(for: .mediaBox)
    guard page.rotation == 0, let text = page.string else { return [] }
    let matches = timeRange.matches(in: text, range: NSRange(text.startIndex..., in: text))
    return matches.compactMap { match in
        guard let sel = page.selection(for: match.range), let found = sel.string else { return nil }
        let b = sel.bounds(for: page)
        return [
            "text": found, "x": rounded(b.minX - media.minX), "y": rounded(media.maxY - b.maxY),
            "w": rounded(b.width), "h": rounded(b.height),
        ]
    }
}

/// Recognized boxes of one region, in upright page coordinates.
func readRegion(_ page: PDFPage, _ region: CGRect, _ index: Int, _ used: String,
                _ observations: [VNRecognizedTextObservation]) -> [[String: Any]] {
    observations.compactMap { obs in
        guard let top = obs.topCandidates(1).first else { return nil }
        var b = obs.boundingBox  // normalized, origin bottom-left
        if used == "down" {  // turn the box back by 180 degrees
            b = CGRect(x: 1 - b.maxX, y: 1 - b.maxY, width: b.width, height: b.height)
        }
        return [
            "text": top.string, "region": index,
            "x": rounded(region.minX + b.minX * region.width),
            "y": rounded(region.minY + (1 - b.maxY) * region.height),
            "w": rounded(b.width * region.width),
            "h": rounded(b.height * region.height),
            "conf": (Double(top.confidence) * 100).rounded() / 100,
        ]
    }
}

let opts = parseOptions(CommandLine.arguments)
let (document, page) = loadPage(opts.pdf)
let size = pageSize(page)
let regions = opts.crops.isEmpty ? [CGRect(origin: .zero, size: size)] : opts.crops
var used = opts.orientation ?? "up"
var boxes: [[String: Any]] = []
for (index, region) in regions.enumerated() {
    let image = render(page, region: region, scale: opts.scale)
    if index == 0, let png = opts.png { savePNG(image, to: png) }
    let (orientation, observations) = readImage(image, opts.crops.isEmpty ? opts.orientation : used)
    used = orientation
    boxes += readRegion(page, region, index, orientation, observations)
}
var out: [String: Any] = [
    "width": Double(size.width), "height": Double(size.height), "orientation": used, "boxes": boxes,
]
if opts.crops.isEmpty { out["textTimes"] = textLayerTimes(page) }
withExtendedLifetime(document) {}
let json = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
FileHandle.standardOutput.write(json)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
