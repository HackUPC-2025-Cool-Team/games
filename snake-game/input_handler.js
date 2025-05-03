export function setupInputHandler(sendDirectionCallback) { // Accept a callback
  window.addEventListener("keydown", (e) => {
    let direction = null;
    switch (e.key) {
      case "ArrowUp":
        direction = { x: 0, y: -1 };
        break;
      case "ArrowDown":
        direction = { x: 0, y: 1 };
        break;
      case "ArrowLeft":
        direction = { x: -1, y: 0 };
        break;
      case "ArrowRight":
        direction = { x: 1, y: 0 };
        break;
    }
    // If a direction key was pressed, call the callback
    if (direction) {
        sendDirectionCallback(direction);
    }
  });
}
