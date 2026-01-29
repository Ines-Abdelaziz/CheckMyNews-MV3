console.log("[CMN][BOOTSTRAP] Bridge loaded");

class FBBootstrapBridge {
  constructor(onPost) {
    this.onPost = onPost;
    this.listener = this.handleMessage.bind(this);
  }

  start() {
    window.addEventListener("message", this.listener);
  }

  stop() {
    window.removeEventListener("message", this.listener);
  }

  handleMessage(event) {
    if (event.source !== window) return;
    if (event.data?.source !== "CMN_BOOTSTRAP") return;

    this.onPost(event.data.payload);
  }
}

window.FBBootstrapBridge = FBBootstrapBridge;
