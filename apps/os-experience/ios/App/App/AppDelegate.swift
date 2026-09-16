import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        pushSafeAreaInsetsToWeb()
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    /// Shared layout contract: real iOS safe areas → CSS --ox-safe-* (same as Android WindowInsets bridge).
    private func pushSafeAreaInsetsToWeb() {
        DispatchQueue.main.async { [weak self] in
            guard let root = self?.window?.rootViewController else { return }
            let insets = root.view.safeAreaInsets
            guard let bridge = self?.capacitorBridge() else { return }
            let js = """
            (function(){
              var r=document.documentElement;
              r.style.setProperty('--ox-safe-top','\(insets.top)px');
              r.style.setProperty('--ox-safe-bottom','\(insets.bottom)px');
              r.style.setProperty('--ox-safe-left','\(insets.left)px');
              r.style.setProperty('--ox-safe-right','\(insets.right)px');
              r.dataset.oxInsets='native';
              window.dispatchEvent(new CustomEvent('ox-system-insets',{detail:{top:\(insets.top),bottom:\(insets.bottom),left:\(insets.left),right:\(insets.right)}}));
            })();
            """
            bridge.eval(js: js)
        }
    }

    private func capacitorBridge() -> CAPBridgeProtocol? {
        if let bridgeVC = window?.rootViewController as? CAPBridgeViewController {
            return bridgeVC.bridge
        }
        if let nav = window?.rootViewController as? UINavigationController,
           let bridgeVC = nav.viewControllers.first as? CAPBridgeViewController {
            return bridgeVC.bridge
        }
        return nil
    }
}
