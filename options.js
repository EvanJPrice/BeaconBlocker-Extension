// This function runs when the "Save" button is clicked
function saveOptions() {
  const apiKey = document.getElementById('apiKey').value;
  
  // Save the API key to the extension's local storage
  chrome.storage.sync.set({
    'userApiKey': apiKey
  }, function() {
    // Update the status text to let the user know it saved
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(function() {
      status.textContent = '';
    }, 1500);
  });
}

// This function runs when the options page is opened
function restoreOptions() {
  // Load the "userApiKey" from storage
  chrome.storage.sync.get('userApiKey', function(items) {
    // Display the saved key in the text box
    document.getElementById('apiKey').value = items.userApiKey || '';
  });
}

// Add event listeners to our buttons
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);