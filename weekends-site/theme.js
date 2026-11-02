// Apply the saved theme before the page paints (avoids a flash of the default theme).
try { document.documentElement.dataset.theme = localStorage.getItem('theme') || 'paper'; } catch (e) { document.documentElement.dataset.theme = 'paper'; }

// Load Google's sign-in library.
{
  var gsi = document.createElement('script'); gsi.src = 'https://accounts.google.com/gsi/client'; gsi.async = true; document.head.appendChild(gsi);
}
