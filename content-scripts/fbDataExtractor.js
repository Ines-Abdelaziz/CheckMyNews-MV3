// content-scripts/fbDataExtractor.js
console.log("[CMN] fbDataExtractor loaded");

class FBDataExtractor {
  constructor() {
    this.failedExtractions = 0;
  }

  // Extract all data from post
  extractPostData(element, postId) {
    try {
      const data = {
        postId: postId,
        timestamp: Date.now(),

        // Basic info
        postUrl: this.extractPostUrl(element),
        postTime: this.extractPostTime(element),

        // Author info
        author: this.extractAuthor(element),

        // Content
        content: this.extractContent(element),
        contentLength: 0,

        // Media
        mediaType: this.detectMediaType(element),
        imageUrls: this.extractImageUrls(element),
        videoUrl: this.extractVideoUrl(element),

        // External link
        externalUrl: this.extractExternalUrl(element),
        externalDomain: null,

        // Engagement
        reactions: this.extractReactions(element),
        comments: this.extractComments(element),
        shares: this.extractShares(element),

        // Meta
        isSponsored: this.detectSponsored(element),
        hashtags: this.extractHashtags(element),
        mentions: this.extractMentions(element),

        // Context
        pageUrl: window.location.href,
        pageTitle: document.title,
      };

      // Post-process
      data.contentLength = data.content?.length || 0;
      data.externalDomain = data.externalUrl
        ? this.extractDomain(data.externalUrl)
        : null;

      return data;
    } catch (error) {
      console.error("[CMN] Error extracting post data:", error);
      this.failedExtractions++;
      return null;
    }
  }

  // Extract post URL
  extractPostUrl(element) {
    const selectors = [
      'a[href*="/posts/"]',
      'a[href*="/photos/"]',
      'a[href*="/videos/"]',
      'a[role="link"][href*="facebook.com"]',
    ];

    for (const selector of selectors) {
      const link = element.querySelector(selector);
      if (link?.href) {
        return link.href.split("?")[0];
      }
    }

    return null;
  }

  // Extract post time
  extractPostTime(element) {
    const abbr = element.querySelector("abbr[data-utime]");
    if (abbr) {
      const utime = abbr.getAttribute("data-utime");
      return parseInt(utime) * 1000;
    }
    return Date.now();
  }

  // Extract author information
  extractAuthor(element) {
    const author = {
      name: null,
      profileUrl: null,
      profileId: null,
      pageType: null,
    };

    // Find author link
    const authorLink =
      element.querySelector('a[role="link"]') ||
      element.querySelector('a[href*="facebook.com/"]');

    if (authorLink) {
      author.name = authorLink.textContent.trim();
      author.profileUrl = authorLink.href;
      author.profileId = this.extractProfileId(authorLink.href);

      // Detect if page or profile
      if (authorLink.href.includes("/pages/")) {
        author.pageType = "page";
      } else {
        author.pageType = "profile";
      }
    }

    return author;
  }

  // Extract profile ID from URL
  extractProfileId(url) {
    if (!url) return null;

    // Handle different URL formats
    const patterns = [
      /facebook\.com\/([^/?]+)/,
      /facebook\.com\/pages\/[^/]+\/(\d+)/,
      /facebook\.com\/profile\.php\?id=(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  // Extract post content
  extractContent(element) {
    const contentSelectors = [
      '[data-ad-preview="message"]',
      '[data-ad-comet-preview="message"]',
      'div[dir="auto"]',
      ".userContent",
      '[data-testid="post_message"]',
    ];

    for (const selector of contentSelectors) {
      const contentEl = element.querySelector(selector);
      if (contentEl) {
        return this.cleanText(contentEl.textContent);
      }
    }

    return "";
  }

  // Clean text
  cleanText(text) {
    return text
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, ""); // Remove zero-width characters
  }

  // Detect media type
  detectMediaType(element) {
    if (element.querySelector("video")) return "video";
    if (element.querySelector('img[src*="scontent"]')) return "image";
    if (element.querySelector('[data-testid="post_message"]')) return "text";
    return "unknown";
  }

  // Extract image URLs
  extractImageUrls(element) {
    const images = element.querySelectorAll('img[src*="scontent"]');
    const urls = [];

    images.forEach((img) => {
      if (img.src && !img.src.includes("emoji")) {
        urls.push(img.src);
      }
    });

    return urls;
  }

  // Extract video URL
  extractVideoUrl(element) {
    const video = element.querySelector("video");
    return video?.src || null;
  }

  // Extract external URL
  extractExternalUrl(element) {
    // Look for Facebook redirect links
    const externalLink = element.querySelector('a[href*="l.facebook.com"]');

    if (externalLink) {
      const url = externalLink.href;

      // Decode Facebook redirect URL
      try {
        const urlObj = new URL(url);
        const targetUrl = urlObj.searchParams.get("u");
        if (targetUrl) {
          return decodeURIComponent(targetUrl);
        }
      } catch (e) {
        // Fallback
      }

      return url;
    }

    // Look for direct external links
    const directLink = element.querySelector(
      'a[target="_blank"][rel*="nofollow"]'
    );
    return directLink?.href || null;
  }

  // Extract domain from URL
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace("www.", "");
    } catch (e) {
      return null;
    }
  }

  // Extract reactions count
  extractReactions(element) {
    const reactionSelectors = [
      '[aria-label*="reaction"]',
      '[aria-label*="Like"]',
      'span[aria-label*="people"]',
    ];

    for (const selector of reactionSelectors) {
      const el = element.querySelector(selector);
      if (el) {
        return this.parseNumber(
          el.getAttribute("aria-label") || el.textContent
        );
      }
    }

    return 0;
  }

  // Extract comments count
  extractComments(element) {
    const commentSelectors = [
      '[aria-label*="comment"]',
      'a[href*="/comments/"]',
    ];

    for (const selector of commentSelectors) {
      const el = element.querySelector(selector);
      if (el) {
        return this.parseNumber(el.textContent);
      }
    }

    return 0;
  }

  // Extract shares count
  extractShares(element) {
    const shareSelectors = ['[aria-label*="share"]', 'span:contains("Share")'];

    for (const selector of shareSelectors) {
      const el = element.querySelector(selector);
      if (el) {
        return this.parseNumber(el.textContent);
      }
    }

    return 0;
  }

  // Parse number from text (handles K, M notation)
  parseNumber(text) {
    if (!text) return 0;

    const match = text.match(/(\d+(?:\.\d+)?)\s*([KM])?/i);
    if (!match) return 0;

    let num = parseFloat(match[1]);
    const suffix = match[2];

    if (suffix) {
      if (suffix.toUpperCase() === "K") num *= 1000;
      if (suffix.toUpperCase() === "M") num *= 1000000;
    }

    return Math.round(num);
  }

  // Detect if sponsored
  detectSponsored(element) {
    const text = element.textContent.toLowerCase();
    const keywords = ["sponsored", "спонсируется", "sponsorisé", "patrocinado"];
    return keywords.some((k) => text.includes(k));
  }

  // Extract hashtags
  extractHashtags(element) {
    const hashtags = [];
    const links = element.querySelectorAll('a[href*="/hashtag/"]');

    links.forEach((link) => {
      const tag = link.textContent.trim();
      if (tag.startsWith("#")) {
        hashtags.push(tag);
      }
    });

    return hashtags;
  }

  // Extract mentions
  extractMentions(element) {
    const mentions = [];
    const links = element.querySelectorAll('a[data-hovercard*="user"]');

    links.forEach((link) => {
      const mention = link.textContent.trim();
      if (mention.startsWith("@") || link.href.includes("facebook.com")) {
        mentions.push({
          name: mention,
          url: link.href,
        });
      }
    });

    return mentions;
  }

  // Get extraction stats
  getStats() {
    return {
      failedExtractions: this.failedExtractions,
    };
  }
  // Detect ad type
  detectAdType(element) {
    const text = element.textContent.toLowerCase();

    if (text.includes("paid for by") || text.includes("political ad")) {
      return "political";
    }

    if (element.querySelector('a[href*="/ads/"]')) {
      return "sponsored";
    }

    if (text.includes("suggested for you")) {
      return "suggested";
    }

    return "boosted";
  }

  // Extract advertiser name
  extractAdvertiserName(element) {
    // Look for "Sponsored" or "Paid for by" text
    const sponsorText = element.querySelector('[aria-label*="Sponsored"]');
    if (sponsorText) {
      const text = sponsorText.textContent;
      // Parse "Sponsored by XYZ"
      const match = text.match(/(?:Sponsored|Paid for) by (.+)/i);
      if (match) return match[1].trim();
    }

    // Fallback to author name
    return this.extractAuthor(element).name;
  }

  // Extract call-to-action
  extractCTA(element) {
    const ctaButtons = element.querySelectorAll('a[role="button"], button');

    for (const button of ctaButtons) {
      const text = button.textContent.trim().toLowerCase();
      const ctaKeywords = [
        "learn more",
        "shop now",
        "sign up",
        "download",
        "get offer",
        "book now",
        "subscribe",
        "apply",
      ];

      if (ctaKeywords.some((keyword) => text.includes(keyword))) {
        return button.textContent.trim();
      }
    }

    return null;
  }

  // Extract ad transparency info
  extractAdInfo(element) {
    const adInfoLink = element.querySelector('a[href*="/ads/about"]');
    if (!adInfoLink) return null;

    return {
      adInfoUrl: adInfoLink.href,
      hasTransparency: true,
    };
  }
}

// Export
window.FBDataExtractor = FBDataExtractor;
