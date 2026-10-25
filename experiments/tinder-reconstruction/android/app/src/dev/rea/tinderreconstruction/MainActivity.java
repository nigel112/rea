package dev.rea.tinderreconstruction;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the reconstruction bundle from assets at a synthetic https origin.
 *
 * Using https://app.local/ (rather than file://) keeps the app in a secure
 * context, so the bundle can use crypto.randomUUID, ES modules and absolute
 * paths like /img/tariro.jpg exactly as the web preview does. Every request is
 * answered locally; nothing reaches the network.
 */
public class MainActivity extends Activity {
    private static final String ORIGIN = "https://app.local/";
    private WebView webView;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0b0f"));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        webView.setWebViewClient(new AssetClient());
        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        if (state != null) {
            webView.restoreState(state);
        } else {
            webView.loadUrl(ORIGIN);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        webView.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!url.startsWith(ORIGIN)) {
                return null;
            }
            String path = url.substring(ORIGIN.length());
            int cut = path.indexOf('?');
            if (cut >= 0) {
                path = path.substring(0, cut);
            }
            int hash = path.indexOf('#');
            if (hash >= 0) {
                path = path.substring(0, hash);
            }
            if (path.isEmpty()) {
                path = "index.html";
            }
            if (path.contains("..")) {
                return notFound();
            }

            String mime = guessMime(path);
            String encoding = isTextual(mime) ? "utf-8" : null;
            try {
                // android/stage.mjs output is the assets root (aapt2 -A), so the
                // bundle lands at assets/index.html, assets/img/... and so on.
                InputStream stream = getAssets().open(path);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                return new WebResourceResponse(mime, encoding, 200, "OK", headers, stream);
            } catch (IOException missing) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse(
                    "text/plain",
                    "utf-8",
                    404,
                    "Not Found",
                    new HashMap<String, String>(),
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    private static boolean isTextual(String mime) {
        return mime.startsWith("text/")
                || mime.equals("application/json")
                || mime.equals("image/svg+xml");
    }

    private static String guessMime(String path) {
        int dot = path.lastIndexOf('.');
        String extension = dot >= 0 ? path.substring(dot + 1).toLowerCase() : "";
        switch (extension) {
            case "html":
                return "text/html";
            case "css":
                return "text/css";
            case "js":
            case "mjs":
                return "text/javascript";
            case "json":
                return "application/json";
            case "svg":
                return "image/svg+xml";
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "png":
                return "image/png";
            case "webp":
                return "image/webp";
            case "ico":
                return "image/x-icon";
            default:
                return "application/octet-stream";
        }
    }
}
