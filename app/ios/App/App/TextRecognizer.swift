import Foundation
import ImageIO
import Vision

/// One line of recognised text. Coordinates are normalised (0–1) with the origin at the top left,
/// matching how the web layer reads a screenshot.
struct RecognizedLine {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    var json: [String: Any] {
        ["text": text, "confidence": Double(confidence), "x": x, "y": y, "width": width, "height": height]
    }
}

enum TextRecognizerError: LocalizedError {
    case unreadableImage

    var errorDescription: String? {
        switch self {
        case .unreadableImage: return "That image could not be read"
        }
    }
}

/// On-device text recognition with Apple's Vision framework. Nothing leaves the phone.
/// Kept free of Capacitor so it can be tested on its own.
enum TextRecognizer {
    static func recognize(imageData: Data) throws -> [RecognizedLine] {
        guard
            let source = CGImageSourceCreateWithData(imageData as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else {
            throw TextRecognizerError.unreadableImage
        }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let rawOrientation = (properties?[kCGImagePropertyOrientation] as? UInt32) ?? 1
        let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Payment receipts are amounts, UPI ids and transaction refs: "correcting" them to dictionary
        // words does more harm than good.
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]

        let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
        try handler.perform([request])

        let lines: [RecognizedLine] = (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox // normalised, origin bottom-left
            return RecognizedLine(
                text: candidate.string,
                confidence: candidate.confidence,
                x: Double(box.minX),
                y: Double(1 - box.maxY),
                width: Double(box.width),
                height: Double(box.height)
            )
        }
        return readingOrder(lines)
    }

    /// Top-to-bottom rows, left-to-right within a row. Lines whose vertical centres are closer than
    /// half a line height belong to the same row ("Paid to" and the amount on one line, for example).
    static func readingOrder(_ lines: [RecognizedLine]) -> [RecognizedLine] {
        let byTop = lines.sorted { ($0.y + $0.height / 2) < ($1.y + $1.height / 2) }
        var rows: [[RecognizedLine]] = []
        for line in byTop {
            let centre = line.y + line.height / 2
            if let last = rows.last?.last, abs((last.y + last.height / 2) - centre) < min(last.height, line.height) / 2 {
                rows[rows.count - 1].append(line)
            } else {
                rows.append([line])
            }
        }
        return rows.flatMap { $0.sorted { $0.x < $1.x } }
    }
}
