package ru.eduflow.app;

import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;

/** Small native API client. WebView and native screens share the same HTTPS session. */
final class EduFlowApi {
    static final String ORIGIN = "https://schoolmeet-vb96.onrender.com";
    static final String HOST = "schoolmeet-vb96.onrender.com";
    private static final int MAX_RESPONSE = 2 * 1024 * 1024;

    static final class Response {
        final int status;
        final JSONObject json;

        Response(int status, JSONObject json) {
            this.status = status;
            this.json = json;
        }
    }

    private EduFlowApi() {}

    /** Only fixed, same-origin GET endpoints may be supplied by the native UI. */
    static Response get(String path, String cookie) throws IOException {
        if (!"/api/auth/session".equals(path)
                && !"/api/schedule".equals(path)
                && !"/api/homework".equals(path)) {
            throw new IllegalArgumentException("Unexpected API endpoint");
        }
        HttpURLConnection conn = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        // Never send a session cookie to a redirect target.
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("Accept", "application/json");
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        try {
            int status = conn.getResponseCode();
            for (Map.Entry<String, List<String>> header : conn.getHeaderFields().entrySet()) {
                if (header.getKey() != null && "Set-Cookie".equalsIgnoreCase(header.getKey())) {
                    for (String value : header.getValue()) {
                        CookieManager.getInstance().setCookie(ORIGIN, value);
                    }
                }
            }
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in == null) return new Response(status, new JSONObject());
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            try {
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (data.size() + read > MAX_RESPONSE) throw new IOException("Response too large");
                    data.write(buffer, 0, read);
                }
            } finally {
                in.close();
            }
            try {
                return new Response(status, new JSONObject(data.toString("UTF-8")));
            } catch (Exception ignored) {
                throw new IOException("Invalid server response");
            }
        } finally {
            conn.disconnect();
        }
    }
}
