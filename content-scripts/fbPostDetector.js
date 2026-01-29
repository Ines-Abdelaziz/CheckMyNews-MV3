// content-scripts/fbPostDetector.js
console.log("[CMN] fbPostDetector loaded");

class FBPostDetector {
  constructor() {
    this.processedPosts = new Set();
    this.postIdCounter = 0;
  }

  // Check if post has already been processed
  isProcessed(postElement) {
    if (postElement.dataset.cmnProcessed === "true") {
      return true;
    }

    const postId = this.generatePostId(postElement);
    return this.processedPosts.has(postId);
  }

  // Mark post as processed
  markAsProcessed(postElement) {
    postElement.dataset.cmnProcessed = "true";
    const postId = this.generatePostId(postElement);
    this.processedPosts.add(postId);
  }

  // Generate unique post ID
  generatePostId(element) {
    // Try to get ID from element attributes
    const pageletId = element.getAttribute("data-pagelet");
    if (pageletId) return pageletId;

    const ariaLabel = element.getAttribute("aria-labelledby");
    if (ariaLabel) return ariaLabel;

    const elementId = element.getAttribute("id");
    if (elementId) return elementId;

    // Fallback: generate from position and content
    const textContent = element.textContent.substring(0, 50);
    const hash = this.hashCode(textContent);
    return `post_${hash}_${this.postIdCounter++}`;
  }

  // Simple hash function
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // Check if post is visible on screen
  isVisible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    const viewHeight =
      window.innerHeight || document.documentElement.clientHeight;

    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= viewHeight + 1000 && // Include 1000px buffer
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  // Get post type
  getPostType(element) {
    // Check for video
    if (element.querySelector("video")) {
      return "video";
    }

    // Check for image
    if (element.querySelector('img[src*="scontent"]')) {
      return "photo";
    }

    // Check for shared link
    if (element.querySelector('a[href*="l.facebook.com"]')) {
      return "shared_link";
    }

    // Check for live video
    if (
      element.textContent.includes("Live") &&
      element.querySelector("video")
    ) {
      return "live";
    }

    return "status";
  }

  // Check if post is sponsored
  isSponsored(element) {
    // Check for sponsored text
    const text = element.textContent.toLowerCase();
    const sponsoredKeywords = [
      "sponsored",
      "спонсируется",
      "sponsorisé",
      "gesponsert",
      "patrocinado",
    ];

    if (sponsoredKeywords.some((keyword) => text.includes(keyword))) {
      return true;
    }

    // Check for sponsored aria-label
    const sponsoredLabel = element.querySelector('[aria-label*="Sponsored"]');
    if (sponsoredLabel) return true;

    // Check for data attributes
    if (element.hasAttribute("data-is-sponsored")) return true;

    return false;
  }

  // Get post timestamp
  getPostTimestamp(element) {
    // Try to find timestamp element
    const timestampSelectors = [
      "abbr[data-utime]",
      "abbr[data-timestamp]",
      'span[id*="feed_subtitle"]',
      'a[href*="/posts/"] abbr',
      'a[href*="/photos/"] abbr',
    ];

    for (const selector of timestampSelectors) {
      const timestampEl = element.querySelector(selector);
      if (timestampEl) {
        const utime = timestampEl.getAttribute("data-utime");
        if (utime) {
          return parseInt(utime) * 1000; // Convert to ms
        }

        const timestamp = timestampEl.getAttribute("data-timestamp");
        if (timestamp) {
          return parseInt(timestamp);
        }
      }
    }

    // Fallback to current time
    return Date.now();
  }

  // Get post URL
  getPostUrl(element) {
    // Look for permalink
    const permalinkSelectors = [
      'a[href*="/posts/"]',
      'a[href*="/photos/"]',
      'a[href*="/videos/"]',
      'a[href*="/permalink/"]',
    ];

    for (const selector of permalinkSelectors) {
      const link = element.querySelector(selector);
      if (link && link.href) {
        return link.href.split("?")[0]; // Remove query params
      }
    }

    return null;
  }

  // Clear processed posts cache (memory management)
  clearCache() {
    const maxCacheSize = 1000;
    if (this.processedPosts.size > maxCacheSize) {
      const toKeep = Array.from(this.processedPosts).slice(-500);
      this.processedPosts = new Set(toKeep);
      console.log("[CMN] Post cache cleared");
    }
  }

  // Get stats
  getStats() {
    return {
      processedCount: this.processedPosts.size,
      postIdCounter: this.postIdCounter,
    };
  }
}

// Export
window.FBPostDetector = FBPostDetector;
