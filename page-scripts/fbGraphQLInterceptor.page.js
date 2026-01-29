// content-scripts/fbGraphQLInterceptor.js
console.log("[CMN][GraphQL] fbGraphQLInterceptor loaded");
console.log("[CMN][GraphQL][PAGE] Running in page context", location.href);

class FBGraphQLInterceptor {
  constructor() {
    this.started = false;

    if (!window.__CMN_GRAPHQL_STORE__) {
      window.__CMN_GRAPHQL_STORE__ = new Map();
    }

    this.store = window.__CMN_GRAPHQL_STORE__;
    this.originalFetch = window.fetch;
    this.originalXHR = window.XMLHttpRequest;
  }

  start() {
    if (this.started) return;
    this.started = true;

    console.log("[CMN][GraphQL] Starting interceptor");

    //this.interceptFetch();
    this.interceptXHR();
  }

  /* ---------------- FETCH ---------------- */

  interceptFetch() {
    const self = this;

    window.fetch = async function (...args) {
      const response = await self.originalFetch.apply(this, args);
      try {
        const url = args[0];
        if (typeof url === "string" && url.includes("graphql")) {
          response
            .clone()
            .text()
            .then((text) => self.parseGraphQLText(text, url))
            .catch(() => {});
        }
      } catch (e) {}

      return response;
    };
  }

  /* ---------------- XHR ---------------- */

  interceptXHR() {
    const self = this;

    window.XMLHttpRequest = function () {
      const xhr = new self.originalXHR();

      const open = xhr.open;
      xhr.open = function (method, url, ...rest) {
        this.__cmn_url = url;
        return open.call(this, method, url, ...rest);
      };

      xhr.addEventListener("load", function () {
        if (!this.__cmn_url?.includes("graphql")) return;

        // Get response text
        const text =
          this.responseText || new TextDecoder("utf-8").decode(this.response);

        if (!text) return;

        try {
          // Parse the JSON (handles newline-separated chunks)
          const jsonData = self.parseJsonSafely(text);

          // Extract posts
          const posts = self.extractFacebookPosts(jsonData);
          //STORE
          if (posts.length > 0) {
            window.__CMN_EXTRACTED_POSTS__ =
              window.__CMN_EXTRACTED_POSTS__.concat(posts);

            sessionStorage.setItem(
              "__CMN_EXTRACTED_POSTS__",
              JSON.stringify(window.__CMN_EXTRACTED_POSTS__)
            );
          }
        } catch (e) {
          console.error("[CMN] Error:", e.message);
        }
      });

      return xhr;
    };
  }

  /* ---------------- PARSING ---------------- */
  parseJsonSafely(text) {
    if (!text) return null;

    // ✅ FIX: Facebook sends MULTIPLE JSON objects separated by newlines
    // Each line is a complete GraphQL response for a different feed segment

    const results = [];
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) continue; // Skip empty lines

      try {
        const parsed = JSON.parse(line);
        results.push(parsed);
      } catch (e) {
        console.warn(
          `[CMN] ⚠️ Line ${i} failed to parse:`,
          e.message.substring(0, 50)
        );
        // Continue to next line instead of stopping
      }
    }

    // If we got multiple results, merge them
    if (results.length > 1) {
      // Return a combined object with all data
      return {
        data: {},
        extensions: {},
        // Merge all the data together
        _allResults: results,
      };
    }

    if (results.length === 1) {
      return results[0];
    }

    throw new Error(
      `Could not parse any valid JSON from ${lines.length} lines`
    );
  }
  extractJSONBlocks(text) {
    const results = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = text.slice(start, i + 1);
          if (candidate.includes('"__typename":"Story"')) {
            results.push(candidate);
          }
          start = -1;
        }
      }
    }

    return results;
  }
  /**
   * Extract post information from a Story node
   */
  extractPostData(storyNode) {
    if (
      !storyNode ||
      storyNode.__typename !== "Story" ||
      !storyNode.viewability_config
    ) {
      return null;
    }

    const post = {
      id: storyNode.id,
      post_id: storyNode.post_id,
      type: storyNode.__typename,
      creation_time:
        storyNode.comet_sections.context_layout.story.comet_sections.metadata[1]
          .story?.creation_time || null,
      author: null,
      attachments: [],
      message: null,
      url: null,
      privacy:
        storyNode.comet_sections.context_layout.story.comet_sections
          ?.metadata[2]?.story.privacy_scope ||
        storyNode.comet_sections.context_layout.story.comet_sections
          ?.metadata[1]?.story.privacy_scope ||
        null,
      attachments: [],
      to: null,
    };
    // --- Extract attachments (ads & link cards) ---
    if (Array.isArray(storyNode.attachments)) {
      post.attachments = storyNode.attachments.map((att) => {
        const style = att.styles;
        const attachment = style?.attachment;
        const media = attachment?.media;
        const linkRenderer = attachment?.story_attachment_link_renderer;
        const webLink = linkRenderer?.attachment?.web_link;

        return {
          renderer_type: style?.__typename || null,

          image: {
            flexible: media?.flexible_height_share_image?.uri || null,
            large: media?.large_share_image?.uri || null,
            width: media?.flexible_height_share_image?.width || null,
            height: media?.flexible_height_share_image?.height || null,
          },

          title: attachment?.title_with_entities?.text || null,

          destination_url: webLink?.url || null,
          fbclid: webLink?.fbclid || null,

          action_links:
            linkRenderer?.attachment?.action_links?.map((a) => a.url) || [],
        };
      });

      post.attachment_count = post.attachments.length;
    }

    // Extract author information
    if (storyNode.actors && storyNode.actors.length > 0) {
      const actor = storyNode.actors[0];
      post.author = {
        name: actor.name,
        id: actor.id,
        type: actor.__typename,
        profile_picture: actor.profile_picture?.uri,
      };
    }

    //extract group information
    if (storyNode.to && storyNode.to.__typename === "Group") {
      const group = storyNode.to;
      post.to = {
        id: group.id,
        name: group.name,
        url: group.url,
      };
    }

    // Extract message/text content
    try {
      // Path 1: comet_sections.content.story.message.text
      if (storyNode.comet_sections?.content?.story?.message?.text) {
        post.message = storyNode.comet_sections.content.story.message.text;
      }
      // Path 2: comet_sections.content.message_container.story.message.text
      else if (
        storyNode.comet_sections?.content?.message_container?.story?.message
          ?.text
      ) {
        post.message =
          storyNode.comet_sections.content.message_container.story.message.text;
      }
    } catch (e) {
      // Message extraction failed, leave as null
    }

    // Extract URL
    try {
      // Path 1: comet_sections.content.story.wwwURL
      if (storyNode.comet_sections?.content?.story?.wwwURL) {
        post.url = storyNode.comet_sections.content.story.wwwURL;
      }
      // Path 2: url field
      else if (storyNode.url) {
        post.url = storyNode.url;
      }
    } catch (e) {
      // URL extraction failed
    }

    // Extract feedback (reactions, comments)
    if (storyNode.feedback?.id) {
      post.feedback_id = storyNode.feedback.id;
    }

    // Extract privacy/audience
    try {
      const privacyScope =
        storyNode.comet_sections?.context_layout?.story?.privacy_scope;
      if (privacyScope) {
        post.privacy = {
          icon: privacyScope.icon_image?.name,
          description: privacyScope.description,
        };
      }
    } catch (e) {
      // Privacy extraction failed
    }

    // Extract attachments
    if (storyNode.attachments && Array.isArray(storyNode.attachments)) {
      post.attachments = storyNode.attachments;
      post.attachment_count = storyNode.attachments.length;
    }

    return post;
  }

  extractFacebookPosts(jsonData) {
    const posts = [];

    const responses = jsonData._allResults ? jsonData._allResults : [jsonData];

    for (const response of responses) {
      // Recursive search for Story nodes
      const findStories = (obj, depth = 0) => {
        if (depth > 30) return; // Prevent infinite recursion

        if (obj && typeof obj === "object") {
          // Check if this node is a Story
          if (obj.__typename === "Story") {
            const postData = this.extractPostData(obj);
            if (postData) {
              posts.push(postData);
            }
          }

          // Recurse into all properties
          for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
              findStories(obj[key], depth + 1);
            }
          }
        } else if (Array.isArray(obj)) {
          for (const item of obj) {
            findStories(item, depth + 1);
          }
        }
      };

      findStories(response);
    }
    if (posts.length > 0) {
      console.log("[CMN][GraphQL] Extracted posts:", posts);
    }

    return posts;
  }
  walk(obj, cb) {
    if (!obj || typeof obj !== "object") return;
    cb(obj);
    for (const key in obj) {
      try {
        this.walk(obj[key], cb);
      } catch (_) {}
    }
  }

  getStats() {
    return {
      started: this.started,
      cachedStories: this.store.size,
    };
  }
}

/* ---------------- BOOTSTRAP ---------------- */

(function () {
  console.log("[CMN][GraphQL][PAGE] Initializing interceptor");
  const interceptor = new FBGraphQLInterceptor();
  interceptor.start();
  window.__CMN_GRAPHQL_INTERCEPTOR__ = interceptor;
  // At the end of your GraphQL interceptor
  window.__CMN_GRAPHQL_POSTS__ = window.__CMN_EXTRACTED_POSTS__ || [];

  // Emit custom event when posts are added
  window.addEventListener("CMN_POSTS_EXTRACTED", (event) => {
    console.log("[GraphQL] Posts extracted:", event.detail);
  });

  // When you add posts to cache, emit event
  if (posts.length > 0) {
    window.__CMN_EXTRACTED_POSTS__.push(...posts);

    window.dispatchEvent(
      new CustomEvent("CMN_POSTS_EXTRACTED", {
        detail: {
          posts: posts,
          count: posts.length,
          timestamp: Date.now(),
        },
      })
    );
  }
})();
