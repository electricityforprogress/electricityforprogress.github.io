const canvas = document.getElementById("starfieldCanvas");
const ctx = canvas.getContext("2d");

let starCount = 400;
let flightSpeed = 3.0; 
let starSize = 5;
let colorScheme = "white";
let isPaused = false;
let animationFrameId = null;

let w = canvas.width = window.innerWidth;
let h = canvas.height = window.innerHeight;

let stars = [];

function initStars() {
    stars = [];
    for (let i = 0; i < starCount; i++) {
        stars.push({
            x: Math.random() * w - w / 2,
            y: Math.random() * h - h / 2,
            z: Math.random() * w,
            color: getRandomColor()
        });
    }
}

function getRandomColor() {
    if (colorScheme === "cyan") return "#9adffd";
    if (colorScheme === "nebula") {
       const colors =  [
              "#ff9ae1", "#ff6b81", "#d980fa", "#c56cf0", // Pinks & Violets
              "#9adffd", "#54a0ff", "#48dbfb", "#0abde3", // Blues & Cyans
              "#9affb5", "#1dd1a1", "#10ac84",            // Greens & Teals
              "#feca57", "#ff9f43", "#ff6b6b",            // Yellows & Oranges
              "#ffffff", "#f1f2f6", "#ffeaa7"             // Whites & Neutrals
            ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    return "#ffffff"; // Classic white
}

window.addEventListener("resize", () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
});

function renderFrame() {
    if (isPaused) return;

    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < stars.length; i++) {
        let star = stars[i];
        star.z -= flightSpeed;

        if (star.z <= 0) {
            star.x = Math.random() * w - w / 2;
            star.y = Math.random() * h - h / 2;
            star.z = w;
            star.color = getRandomColor();
        }

        const px = (star.x / star.z) * w + w / 2;
        const py = (star.y / star.z) * h + h / 2;

        if (px >= 0 && px < w && py >= 0 && py < h) {
            const depthAlpha = 1 - (star.z / w);
            
            if (colorScheme === "white") {
                ctx.fillStyle = "rgba(255, 255, 255, " + depthAlpha + ")";
            } else if (colorScheme === "cyan") {
                ctx.fillStyle = "rgba(154, 223, 253, " + depthAlpha + ")";
            } else {
                ctx.fillStyle = star.color; // Nebula mode alpha injection handled directly by the color hex
            }
            
            ctx.fillRect(px, py, starSize, starSize);
        }
    }
    animationFrameId = requestAnimationFrame(renderFrame);
}

// Control Panel Handlers
function toggleControls() {
    document.getElementById("starfield-panel").classList.toggle("active");
}

function updateSpeed(val) {
    flightSpeed = parseFloat(val);
    document.getElementById("speed-val").innerText = val;
}

function updateCount(val) {
    starCount = parseInt(val);
    document.getElementById("count-val").innerText = val;
    initStars();
}

function updateSize(val) {
    starSize = parseInt(val);
    document.getElementById("size-val").innerText = val;
}

function updateColorScheme(val) {
    colorScheme = val;
    initStars();
}

function togglePause() {
    isPaused = !isPaused;
    document.getElementById("pauseBtn").innerText = isPaused ? "Resume" : "Pause";
    if (!isPaused) {
        renderFrame();
    }
}

function resetStars() {
    flightSpeed = 3.0;
    starCount = 400;
    starSize = 5;
    colorScheme = "white";
    
    document.getElementById("speedRange").value = 3.0;
    document.getElementById("speed-val").innerText = "3.0";
    document.getElementById("countRange").value = 400;
    document.getElementById("count-val").innerText = "400";
    document.getElementById("sizeRange").value = 5;
    document.getElementById("size-val").innerText = "5";
    document.getElementById("colorScheme").value = "white";
    
    initStars();
}

// Kick off initialization
initStars();
renderFrame();