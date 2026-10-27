package com.pickandcase.assistant;

import java.net.URI;

final class OriginPolicy {
    static boolean trusted(String url) {
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "ai.pickandcase.com".equalsIgnoreCase(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getRawUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
    private OriginPolicy() {}
}
