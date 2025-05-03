// Make sendInputAction globally accessible or pass it properly
var sendInputAction = null; // Will be set by script.js

function setupInputHandler(actionCallback) {
  sendInputAction = actionCallback; // Store the callback

  window.addEventListener("keydown", (e) => {
    let action = null;
    switch (e.key) {
      case "ArrowLeft":
      case "a": // Add A for left
        action = "left";
        break;
      case "ArrowRight":
      case "d": // Add D for right
        action = "right";
        break;
    }

    if (action && sendInputAction) {
        sendInputAction(action);
    }
  });
}

// Ensure the function is available globally if script.js needs it directly
window.setupInputHandler = setupInputHandler;
