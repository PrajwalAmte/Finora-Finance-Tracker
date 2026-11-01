import Capacitor
import UIKit

/// Bridge view controller that registers Finora's own native plugins, which live in the app target
/// rather than in npm packages.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TextRecognizerPlugin())
    }
}
