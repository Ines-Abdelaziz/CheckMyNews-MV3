// content-scripts/fbStorageManager.js
console.log("[CMN] fbStorageManager loaded");

class FBStorageManager {
  constructor() {
    this.queue = [];
    this.maxQueueSize = 50;
    this.sendInterval = 60000; // 60 seconds
    this.sendTimer = null;
    this.isSending = false;
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

    console.log(`[CMN] Post added to queue. Queue size: ${this.queue.length}`);

    // Send if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.sendData();
    }
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

    console.log("[CMN] Periodic send started");
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
      console.log("[CMN] Already sending data, skipping");
      return;
    }

    if (this.queue.length === 0) {
      console.log("[CMN] Queue empty, nothing to send");
      return;
    }

    this.isSending = true;

    const dataToSend = [...this.queue];
    this.queue = []; // Clear queue

    try {
      console.log(`[CMN] Sending ${dataToSend.length} posts to background`);

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
        console.log("[CMN] Data sent successfully");
        this.clearStoredData();
      } else {
        console.warn("[CMN] Send failed, re-queuing data");
        this.queue.unshift(...dataToSend);
      }
    } catch (error) {
      console.error("[CMN] Error sending data:", error);

      // Re-add to queue on error
      this.queue.unshift(...dataToSend);

      // Save to storage as backup
      this.saveUnsentData();
    } finally {
      this.isSending = false;
    }
  }

  // Save unsent data to chrome.storage
  async saveUnsentData() {
    try {
      await chrome.storage.local.set({
        cmn_unsent_posts: this.queue,
        cmn_last_save: Date.now(),
      });
      console.log("[CMN] Unsent data saved to storage");
    } catch (error) {
      console.error("[CMN] Error saving to storage:", error);
    }
  }

  // Load unsent data from chrome.storage
  async loadUnsentData() {
    try {
      const result = await chrome.storage.local.get(["cmn_unsent_posts"]);
      if (result.cmn_unsent_posts && Array.isArray(result.cmn_unsent_posts)) {
        this.queue = result.cmn_unsent_posts;
        console.log(
          `[CMN] Loaded ${this.queue.length} unsent posts from storage`
        );
      }
    } catch (error) {
      console.error("[CMN] Error loading from storage:", error);
    }
  }

  // Clear stored data
  async clearStoredData() {
    try {
      await chrome.storage.local.remove(["cmn_unsent_posts"]);
      console.log("[CMN] Stored data cleared");
    } catch (error) {
      console.error("[CMN] Error clearing storage:", error);
    }
  }

  // Setup handler for page unload
  setupUnloadHandler() {
    window.addEventListener("beforeunload", () => {
      if (this.queue.length > 0) {
        // Try to send immediately
        this.sendData();
        // Also save to storage as backup
        this.saveUnsentData();
      }
    });

    // Also handle visibility change
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.queue.length > 0) {
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
    console.log("[CMN] Queue cleared");
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
