import Capacitor
import Foundation

/// Exposes `TextRecognizer` to the web layer as `TextRecognizer.recognize({ base64 })`.
/// Registered in `MainViewController`; Android uses ML Kit through @capacitor-community/image-to-text.
@objc(TextRecognizerPlugin)
public class TextRecognizerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextRecognizerPlugin"
    public let jsName = "TextRecognizer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "app.finora.text-recognizer", qos: .userInitiated)

    @objc func recognize(_ call: CAPPluginCall) {
        guard var base64 = call.getString("base64"), !base64.isEmpty else {
            call.reject("No image was provided")
            return
        }
        if let comma = base64.firstIndex(of: ","), base64.hasPrefix("data:") {
            base64 = String(base64[base64.index(after: comma)...])
        }
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            call.reject("The image data is not valid base64")
            return
        }
        // Vision is synchronous and can take a second on a large screenshot; keep it off the main thread.
        queue.async {
            do {
                let lines = try TextRecognizer.recognize(imageData: data)
                call.resolve(["lines": lines.map { $0.json }])
            } catch {
                call.reject(error.localizedDescription, nil, error)
            }
        }
    }
}
