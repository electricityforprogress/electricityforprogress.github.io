// Function to fetch and inject HTML
async function loadComponent(elementId, filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error('Failed to load ' + filePath);
        const html = await response.text();
        document.getElementById(elementId).innerHTML = html;
    } catch (error) {
        console.error('Error loading component:', error);
    }
}

// Load everything as soon as the main DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('nav-placeholder', '/components/nav.html');
    loadComponent('footer-placeholder', '/components/footer.html');
});