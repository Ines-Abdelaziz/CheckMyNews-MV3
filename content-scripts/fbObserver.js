// content-scripts/fbObserver.js
console.log("[CMN] fbObserver loaded");
function isPublicPost(post) {
  const svgs = post.querySelectorAll("svg");

  for (const svg of svgs) {
    const w = parseInt(svg.getAttribute("width") || "0", 10);
    const h = parseInt(svg.getAttribute("height") || "0", 10);

    if (w > 20 || h > 20) continue;
    if (svg.closest("a")) continue;

    const paths = svg.querySelectorAll("path");
    if (paths.length >= 3) {
      return true; // 🌍 public
    }
  }

  return false;
}

class FBObserver {
  constructor(onPostFound, onPostRemoved) {
    this.observer = null;
    this.onPostFound = onPostFound;
    this.onPostRemoved = onPostRemoved;
    this.feedContainer = null;
    this.isObserving = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Find the main feed container
  findFeedContainer() {
    console.log("[CMN] Using document.body as observer root");
    return document.body;
  }

  // Start observing the feed
  start() {
    if (this.isObserving) {
      console.log("[CMN] Observer already running");
      return;
    }

    this.feedContainer = this.findFeedContainer();

    if (!this.feedContainer) {
      console.log("[CMN] Feed not ready, will retry...");
      this.scheduleReconnect();
      return;
    }

    // Process existing posts first
    this.processExistingPosts();

    // Setup mutation observer
    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    this.observer.observe(this.feedContainer, {
      childList: true,
      subtree: true,
    });

    this.isObserving = true;
    this.reconnectAttempts = 0;
    console.log("[CMN] Observer started successfully");
  }

  // Stop observing
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.isObserving = false;
    console.log("[CMN] Observer stopped");
  }

  // Process existing posts in feed
  processExistingPosts() {
    if (!this.feedContainer) return;

    const existingPosts = this.findAllPostElements(this.feedContainer);
    console.log(`[CMN] Processing ${existingPosts.length} existing posts`);

    existingPosts.forEach((post) => {
      if (this.onPostFound) {
        this.onPostFound(post);
      }
    });
  }

  // Handle mutation events
  handleMutations(mutations) {
    const processedNodes = new Set();

    mutations.forEach((mutation) => {
      // Handle added nodes
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (processedNodes.has(node)) return;

        processedNodes.add(node);

        // Check if node itself is a post
        if (this.isPostElement(node)) {
          if (this.onPostFound) {
            this.onPostFound(node);
          }
        }

        // Check for posts within the node
        // const posts = this.findAllPostElements(node);
        // posts.forEach((post) => {
        //   if (!processedNodes.has(post)) {
        //     processedNodes.add(post);
        //     if (this.onPostFound) {
        //       this.onPostFound(post);
        //     }
        //   }
        // });
      });

      // Handle removed nodes (optional)
      mutation.removedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (this.isPostElement(node) && this.onPostRemoved) {
          this.onPostRemoved(node);
        }
      });
    });
  }

  // Find the real post root from a profile header
  findPostRootFromProfile(profileEl) {
    let el = profileEl;

    while (el && el !== document.body) {
      const hasMenu =
        el.querySelector('[aria-label="Actions for this post"]') ||
        el.querySelector('[aria-label="More actions"]');

      if (hasMenu) {
        return el;
      }

      el = el.parentElement;
    }

    return null;
  }

  // Find all post elements in a container
  findAllPostElements(container) {
    const profiles = container.querySelectorAll(
      '[data-ad-rendering-role^="profile_name"]'
    );

    const posts = [];

    profiles.forEach((profile) => {
      const post = profile.closest('div[data-virtualized="false"]');
      if (isPublicPost(post)) posts.push(post);
    });

    console.log(`[CMN] Found ${posts.length} public posts via profile headers`);
    return [...new Set(posts)];
  }

  // Check if element is a post
  isPostElement(element) {
    if (!element || !element.querySelector) return false;

    return !!element.querySelector('[data-ad-rendering-role^="profile_name"]');
  }

  // Schedule reconnection attempt
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[CMN] Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

    console.log(
      `[CMN] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`
    );

    setTimeout(() => {
      this.start();
    }, delay);
  }

  // Reset observer (useful for navigation)
  reset() {
    console.log("[CMN] Resetting observer");
    this.stop();
    this.reconnectAttempts = 0;
    setTimeout(() => this.start(), 1000);
  }

  // Get status
  getStatus() {
    return {
      isObserving: this.isObserving,
      hasFeedContainer: !!this.feedContainer,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Export for use in other scripts
window.FBObserver = FBObserver;
