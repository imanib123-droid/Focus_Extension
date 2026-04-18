chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "START_EYE_TRACKER") {
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
      const video = document.createElement("video");
      video.srcObject = stream;
      video.play();
      setInterval(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 240;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL("image/jpeg");
        fetch("http://127.0.0.1:5000/distracted", {
          method: "POST",
          body: frame,
          headers: { "Content-Type": "text/plain" }
        }).then(res => res.json()).then(data => {
          if (data.distracted) chrome.runtime.sendMessage({ type: "EYE_TRACKER_DISTRACTED" });
        });
      }, 5000); // Check every 5s
    }).catch(() => alert("Camera access denied."));
  }
});