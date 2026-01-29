// content-scripts/fbMain.js
console.log("[CMN] fbMain starting");

(function () {
  if (!location.hostname.includes("facebook.com")) return;

  class CheckMyNewsMain {
    constructor() {
      // Components
      this.graphqlInterceptor = null;
      this.graphql = null;
      this.observer = null;
      this.postDetector = null;
      this.dataExtractor = null;
      this.newsFilter = null;
      this.storageManager = null;
      this.messageHandler = null;
      this.bootstrapBridge = null;

      // State
      this.monitoring = false;
      this.initialized = false;

      // Config
      this.config = {
        enabled: true,
        debugMode: false,
        collectSponsored: true,
        autoStart: true,
      };

      // Stats
      this.stats = {
        postsDetected: 0,
        newsPostsCollected: 0,
        adsCollected: 0,
        regularPostsIgnored: 0,
        errors: 0,
        graphqlPostsReceived: 0, // ✅ From GraphQL XHR
        bootstrapPostsReceived: 0, // ✅ From Bootstrap extractor
        domPostsVerified: 0, // ✅ Posts found in DOM
      };
    }

    async init() {
      if (this.initialized) return;

      console.log("[CMN] Initializing all components...");

      try {
        // Load config
        await this.loadConfig();

        if (!this.config.enabled) {
          console.log("[CMN] Extension disabled by config");
          return;
        }

        // Initialize all components
        this.messageHandler = new FBMessageHandler();
        this.postDetector = new FBPostDetector();
        this.dataExtractor = new FBDataExtractor();
        this.newsFilter = new FBNewsFilter();
        this.storageManager = new FBStorageManager();
        this.storageManager.init();

        // Initialize observer
        this.observer = new FBObserver();

        // ✅ Setup bridges for all three post sources
        this.setupGraphQLBridge(); // GraphQL XHR posts
        this.setupBootstrapBridge(); // Bootstrap initial posts
        this.setupDOMBridge(); // DOM verification

        // Setup event handlers
        this.setupEventHandlers();

        // Start monitoring
        if (this.config.autoStart) {
          this.start();
        }

        this.initialized = true;
        console.log("[CMN] ✅ All components initialized (3 sources active)");
        console.log("[CMN] Sources: GraphQL XHR, Bootstrap, DOM Observer");
      } catch (error) {
        console.error("[CMN] ❌ Initialization failed:", error);
        this.stats.errors++;
      }
    }

    // ================================================================================
    // ✅ SOURCE 1: GRAPHQL XHR BRIDGE
    // ================================================================================
    setupGraphQLBridge() {
      window.addEventListener("CMN_POSTS_EXTRACTED", (event) => {
        const { posts } = event.detail;

        console.log(`[CMN] 📡 Received ${posts.length} posts from GraphQL XHR`);

        posts.forEach((post) => {
          this.handlePostFromSource(post, "graphql");
        });
      });

      console.log("[CMN] ✅ GraphQL XHR bridge listening");
    }

    // ================================================================================
    // ✅ SOURCE 2: BOOTSTRAP BRIDGE
    // ================================================================================
    setupBootstrapBridge() {
      // Listen for bootstrap posts from the injected extractor
      window.addEventListener("CMN_BOOTSTRAP_POSTS_EXTRACTED", (event) => {
        const { posts } = event.detail;

        console.log(`[CMN] 📦 Received ${posts.length} posts from Bootstrap`);

        posts.forEach((post) => {
          this.handlePostFromSource(post, "bootstrap");
        });
      });

      // Also check if bootstrap extractor already ran
      // (in case it finishes before this listener is set up)
      if (window.__CMN_BOOTSTRAP_POSTS__) {
        console.log(
          `[CMN] 📦 Bootstrap posts already available: ${window.__CMN_BOOTSTRAP_POSTS__.length}`
        );

        window.__CMN_BOOTSTRAP_POSTS__.forEach((post) => {
          this.handlePostFromSource(post, "bootstrap");
        });
      }

      console.log("[CMN] ✅ Bootstrap bridge listening");
    }

    // ================================================================================
    // ✅ SOURCE 3: DOM BRIDGE (when observer detects posts)
    // ================================================================================
    setupDOMBridge() {
      // Listen for posts detected in DOM by observer
      window.addEventListener("CMN_DOM_POST_DETECTED", (event) => {
        const { post } = event.detail;

        console.log(`[CMN] 👁️ Post detected in DOM: ${post.post_id}`);

        this.handlePostFromSource(post, "dom");
      });

      console.log("[CMN] ✅ DOM bridge listening");
    }

    // ================================================================================
    // ✅ UNIFIED HANDLER: Process posts from any source
    // ================================================================================
    handlePostFromSource(post, source) {
      try {
        // 1. Deduplication: Check if already processed (by post_id)
        if (this.postDetector.isProcessed(post)) {
          console.log(
            `[CMN] ⚠️ Post already processed: ${post.post_id} (source: ${source})`
          );
          return;
        }

        // 2. Mark as processed
        this.postDetector.markAsProcessed(post);

        // 3. Check if it's a news post
        const postForFilter = {
          url: post.url,
          message: post.message,
          domain: this.extractDomain(post.url),
        };

        const isNews = this.newsFilter.isNewsPost(postForFilter);

        if (!isNews) {
          this.stats.regularPostsIgnored++;

          if (this.config.debugMode) {
            console.log(
              `[CMN] ⏭️ Non-news post ignored from ${source}: ${post.author?.name}`
            );
          }
          return;
        }

        // 4. It's a news post - extract category
        const newsCategory = this.newsFilter.getDomainCategory(post.url);

        // 5. Create unified post data object
        const postData = {
          // Unique identifier
          id: post.id || post.post_id,
          post_id: post.post_id,

          // Content
          author: post.author?.name || post.author,
          message: post.message,
          url: post.url,

          // Metadata
          creation_time: post.creation_time,
          privacy: post.privacy_description || post.privacy,
          isSponsored: post.isSponsored || false,

          // Categorization
          newsCategory: newsCategory,
          externalDomain: this.extractDomain(post.url),

          // ✅ SOURCE TRACKING (critical for understanding origin)
          source: source, // 'graphql', 'bootstrap', or 'dom'
          detectedAt: Date.now(),

          // ✅ DOM VERIFICATION STATUS
          inDOM: source === "dom" ? true : false, // Already in DOM if source is 'dom'
          domFoundAt: source === "dom" ? Date.now() : null,
          domCheckCompleted: source === "dom" ? true : false,
        };

        // 6. Add to storage
        this.storageManager.addPost(postData);

        // 7. Update stats
        this.stats.newsPostsCollected++;

        if (source === "graphql") {
          this.stats.graphqlPostsReceived++;
        } else if (source === "bootstrap") {
          this.stats.bootstrapPostsReceived++;
        } else if (source === "dom") {
          this.stats.domPostsVerified++;
        }

        console.log(
          `[CMN] ✅ News collected from ${source}: ${postData.externalDomain} (${newsCategory})`
        );

        // 8. If from GraphQL or Bootstrap, wait for DOM verification
        if (source !== "dom") {
          this.waitForPostInDOM(postData);
        }
      } catch (error) {
        console.error(`[CMN] Error handling ${source} post:`, error);
        this.stats.errors++;
      }
    }

    // ================================================================================
    // ✅ DOM VERIFICATION: Wait for post to appear in actual DOM
    // ================================================================================
    waitForPostInDOM(postData) {
      const maxWaitTime = 30000; // 30 seconds
      const checkInterval = 1000; // Check every 1 second
      let elapsed = 0;

      const checkDOM = () => {
        // Try to find the post in DOM
        const postElement = this.findPostInDOM(postData.post_id);

        if (postElement) {
          // ✅ Found in DOM!
          postData.inDOM = true;
          postData.domFoundAt = Date.now();
          postData.domCheckCompleted = true;

          console.log(
            `[CMN] ✅ Post verified in DOM after ${elapsed}ms: ${postData.post_id}`
          );

          // Update in storage
          this.storageManager.updatePost(postData.id, {
            inDOM: true,
            domFoundAt: postData.domFoundAt,
            domCheckCompleted: true,
          });

          return; // Stop checking
        }

        elapsed += checkInterval;

        if (elapsed < maxWaitTime) {
          setTimeout(checkDOM, checkInterval);
        } else {
          console.warn(
            `[CMN] Post never verified in DOM (30s timeout): ${postData.post_id}`
          );

          postData.inDOM = false;
          postData.domCheckCompleted = true;

          // Still mark as checked
          this.storageManager.updatePost(postData.id, {
            inDOM: false,
            domCheckCompleted: true,
          });
        }
      };

      checkDOM();
    }

    // ================================================================================
    // ✅ DOM SEARCH: Multiple selector strategies
    // ================================================================================
    findPostInDOM(postId) {
      if (!postId) return null;

      // Try multiple selectors Facebook might use
      const selectors = [
        `[data-post-id="${postId}"]`,
        `[data-ftid*="${postId}"]`,
        `article[data-feed-item-id*="${postId}"]`,
        `[id*="${postId}"]`,
        `[data-deferred-id*="${postId}"]`,
      ];

      for (const selector of selectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            return element;
          }
        } catch (e) {
          console.debug("[CMN] Selector error:", selector);
        }
      }

      return null;
    }

    // ================================================================================
    // ✅ UTILITY: Extract domain from URL
    // ================================================================================
    extractDomain(url) {
      if (!url) return null;
      try {
        const domain = new URL(url).hostname;
        return domain.replace("www.", "");
      } catch (e) {
        return null;
      }
    }

    logGraphQLStats() {
      if (!this.graphqlStore) return;

      console.log("[CMN] GraphQL cached posts:", this.graphqlStore.size);

      for (const [id, data] of this.graphqlStore.entries()) {
        console.log("[CMN][GraphQL POST]", id, data.creationTime);
        break; // avoid spam
      }
    }

    setupEventHandlers() {
      this.messageHandler.on("stats-requested", ({ sendResponse }) => {
        sendResponse(this.getStats());
      });

      this.messageHandler.on("start-monitoring", () => {
        this.start();
      });

      this.messageHandler.on("stop-monitoring", () => {
        this.stop();
      });

      this.messageHandler.on("clear-queue", () => {
        this.storageManager.clearQueue();
      });

      this.messageHandler.on("config-updated", ({ config, sendResponse }) => {
        this.updateConfig(config);
        sendResponse({ success: true });
      });
    }

    start() {
      if (this.monitoring) return;
      this.monitoring = true;
      this.observer.start();
      console.log("[CMN] ✅ Monitoring started");
    }

    stop() {
      if (!this.monitoring) return;
      this.monitoring = false;
      this.observer.stop();
      console.log("[CMN] ⏸️ Monitoring stopped");
    }

    handlePost(post) {
      try {
        console.log("[CMN] Post detected:", post);
        this.stats.postsDetected++;

        // 1. Check if already processed
        if (this.postDetector.isProcessed(post)) {
          return;
        }

        // 2. Generate unique ID
        const postId = this.postDetector.generatePostId(post);

        // 3. Extract all data
        const postData = this.dataExtractor.extractPostData(post, postId);

        if (!postData) {
          this.stats.errors++;
          return;
        }

        // 4. Check if it's news (works for both ads and organic)
        const isNews = this.newsFilter.isNewsPost(postData);

        if (isNews) {
          // Add news category
          postData.newsCategory = this.newsFilter.getDomainCategory(
            postData.externalDomain
          );
          postData.source = "dom"; // Mark as DOM origin

          // 5. Add to queue (batched sending)
          this.storageManager.addPost(postData);

          // 6. Update stats
          if (postData.isSponsored) {
            this.stats.adsCollected++;
            console.log(
              `[CMN] ✅ Sponsored news collected: ${postData.externalDomain}`
            );
          } else {
            this.stats.newsPostsCollected++;
            console.log(
              `[CMN] ✅ Organic news collected: ${postData.externalDomain}`
            );
          }
        } else {
          this.stats.regularPostsIgnored++;

          if (this.config.debugMode) {
            console.log(
              `[CMN] ⏭️ Non-news post ignored ${
                postData.isSponsored ? "(ad)" : "(organic)"
              }`
            );
          }
        }

        // 7. Mark as processed
        this.postDetector.markAsProcessed(post);

        // 8. Periodic cache cleanup
        if (this.stats.postsDetected % 100 === 0) {
          this.postDetector.clearCache();
        }
      } catch (error) {
        console.error("[CMN] Error handling post:", error);
        this.stats.errors++;
      }
    }

    handlePostRemoved(post) {
      if (this.config.debugMode) {
        console.log("[CMN] Post removed from DOM");
      }
    }

    async loadConfig() {
      try {
        const result = await chrome.storage.local.get(["cmn_config"]);
        if (result.cmn_config) {
          this.config = { ...this.config, ...result.cmn_config };
          console.log("[CMN] Config loaded:", this.config);
        }
      } catch (error) {
        console.error("[CMN] Error loading config:", error);
      }
    }

    async updateConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };

      try {
        await chrome.storage.local.set({ cmn_config: this.config });
        console.log("[CMN] Config updated:", this.config);
      } catch (error) {
        console.error("[CMN] Error saving config:", error);
      }
    }

    getStats() {
      return {
        ...this.stats,
        isMonitoring: this.monitoring,
        isInitialized: this.initialized,
        queueStats: this.storageManager?.getStats() || {},
        observerStats: this.observer?.getStatus?.() || {},
        detectorStats: this.postDetector?.getStats() || {},
        extractorStats: this.dataExtractor?.getStats() || {},
      };
    }

    destroy() {
      console.log("[CMN] Cleaning up...");
      this.stop();
      if (this.storageManager) {
        this.storageManager.destroy();
      }
      if (this.graphqlInterceptor) {
        this.graphqlInterceptor.stop();
      }

      console.log("[CMN] Cleanup complete");
    }
  }

  // Initialize
  const main = new CheckMyNewsMain();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => main.init());
  } else {
    main.init();
  }

  // Cleanup on unload

  // Expose for debugging
  window.CMN = main;
})();
