// content-scripts/fbStorageManager.js

class FBStorageManager {
  constructor() {
    this.queue = [];
    this.maxQueueSize = 50;
    this.sendInterval = 60000; // 60 seconds
    this.sendTimer = null;
    this.isSending = false;
    this.contextInvalidated = false;
  }

  log(...args) {
    const debug =
      (window?.CMN?.config && window.CMN.config.debugMode) ||
      localStorage.getItem("CMN_DEBUG") === "1";
    if (debug) {
    }
  }

  // Initialize
  init() {
    // Load any unsent data from storage
    this.loadUnsentData();

    // Start periodic sending
    this.startPeriodicSend();

    // Send on page unload
    this.setupUnloadHandler();
  }

  // Add post to queue
  addPost(postData) {
    if (!postData) return;

    this.queue.push({
      ...postData,
      queuedAt: Date.now(),
    });

    this.log("Queued post", {
      id: postData.id || postData.post_id || postData.postId,
      source: postData.source,
      isSponsored: postData.isSponsored,
    });

    // Send if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.sendData();
    }

    return true;
  }

  // Update a queued post by id/post_id
  updatePost(id, updates = {}) {
    if (!id) return;

    const idx = this.queue.findIndex(
      (p) => p?.id === id || p?.post_id === id || p?.postId === id
    );

    if (idx === -1) return;

    this.queue[idx] = {
      ...this.queue[idx],
      ...updates,
      updatedAt: Date.now(),
    };
  }

  // Start periodic sending
  startPeriodicSend() {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
    }

    this.sendTimer = setInterval(() => {
      if (this.queue.length > 0) {
        this.sendData();
      }
    }, this.sendInterval);

  }

  // Stop periodic sending
  stopPeriodicSend() {
    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  // Send data to background
  async sendData() {
    if (this.isSending) {
      return;
    }

    if (this.queue.length === 0 || this.contextInvalidated) {
      return;
    }

    this.isSending = true;

    const dataToSend = [...this.queue];
    this.queue = []; // Clear queue

    try {
      this.log("sendData start", {
        count: dataToSend.length,
        pageUrl: window.location.href,
      });
      this.log("Data payload", dataToSend);

      if (!chrome?.runtime?.id) {
        this.log("Extension context invalidated before send", {
          runtimeId: chrome?.runtime?.id || null,
        });
        throw new Error("Extension context invalidated");
      }

      const registerAdPayloads = dataToSend
        .map((item) => item?.register_ad_payload)
        .filter(Boolean);

      if (registerAdPayloads.length > 0) {
        const batchResp = await chrome.runtime.sendMessage({
          type: "REGISTER_AD_BATCH",
          payloads: registerAdPayloads,
          metadata: {
            timestamp: Date.now(),
            pageUrl: window.location.href,
            count: registerAdPayloads.length,
          },
        });
        this.applyDbIdMappings(dataToSend, batchResp?.mappings || []);
      }

      const response = await chrome.runtime.sendMessage({
        type: "POSTS_COLLECTED",
        data: dataToSend,
        metadata: {
          timestamp: Date.now(),
          pageUrl: window.location.href,
          count: dataToSend.length,
        },
      });

      if (response?.success) {
        this.log("sendData success", response);
        this.clearStoredData();
      } else {
        this.log("sendData failed", response);
        this.queue.unshift(...dataToSend);
      }
    } catch (error) {
      const invalidated =
        error?.message?.includes("Extension context invalidated") ||
        error?.message?.includes("Receiving end does not exist");
      if (invalidated) {
        this.contextInvalidated = true;
        this.queue = dataToSend;
        return;
      }

      this.log("sendData error", {
        message: error?.message,
        stack: error?.stack,
      });

      // Re-add to queue on error
      this.queue.unshift(...dataToSend);

      // Save to storage as backup
      this.saveUnsentData();
    } finally {
      this.isSending = false;
    }
  }

  applyDbIdMappings(dataToSend, mappings) {
    if (!Array.isArray(mappings) || mappings.length === 0) return;
    const byKey = new Map();
    for (const m of mappings) {
      const key = m?.adanalyst_ad_id ? String(m.adanalyst_ad_id) : null;
      if (!key || !m?.dbId) continue;
      byKey.set(key, String(m.dbId));
    }
    if (byKey.size === 0) return;

    for (const item of dataToSend) {
      const payload = item?.register_ad_payload;
      const key = payload?.adanalyst_ad_id
        ? String(payload.adanalyst_ad_id)
        : payload?.html_ad_id
        ? String(payload.html_ad_id)
        : null;
      if (!key || !byKey.has(key)) continue;
      const dbId = byKey.get(key);
      item.dbId = dbId;
      if (window?.CMN?.graphqlPostsMap && item?.post_id) {
        const post = window.CMN.graphqlPostsMap.get(item.post_id);
        if (post) {
          post.dbId = dbId;
        }
      }
    }
  }

  // Save unsent data to chrome.storage
  async saveUnsentData() {
    try {
      if (!chrome?.runtime?.id) {
        return;
      }
      await chrome.storage.local.set({
        cmn_unsent_posts: this.queue,
        cmn_last_save: Date.now(),
      });
    } catch (error) {
      const msg = (error?.message || String(error || "")).toLowerCase();
      if (msg.includes("extension context invalidated")) {
        return;
      }
    }
  }

  // Load unsent data from chrome.storage
  async loadUnsentData() {
    try {
      const result = await chrome.storage.local.get(["cmn_unsent_posts"]);
      if (result.cmn_unsent_posts && Array.isArray(result.cmn_unsent_posts)) {
        this.queue = result.cmn_unsent_posts;
      }
    } catch (error) {
    }
  }

  // Clear stored data
  async clearStoredData() {
    try {
      await chrome.storage.local.remove(["cmn_unsent_posts"]);
    } catch (error) {
    }
  }

  // Setup handler for page unload
  setupUnloadHandler() {
    window.addEventListener("beforeunload", () => {
      if (this.queue.length > 0) {
        // Try to send immediately
        this.sendData();
        // Also save to storage as backup
        if (chrome?.runtime?.id) {
          this.saveUnsentData();
        }
      }
    });

    // Also handle visibility change
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.queue.length > 0 && chrome?.runtime?.id) {
        this.saveUnsentData();
      }
    });
  }

  // Get queue stats
  getStats() {
    return {
      queueSize: this.queue.length,
      isSending: this.isSending,
      maxQueueSize: this.maxQueueSize,
    };
  }

  // Clear queue
  clearQueue() {
    this.queue = [];
    this.clearStoredData();
  }

  // Destroy
  destroy() {
    this.stopPeriodicSend();
    if (this.queue.length > 0) {
      this.saveUnsentData();
    }
  }
}

// Export
window.FBStorageManager = FBStorageManager;
