const CNETID_KEY = 'zhoua_auth_key';
let CURRENT_ROOM = null;
let TIMER_ID = null;
let UNREAD_TIMER_ID = null;
let CURRENT_THREAD_PARENT_ID = null;
const SUPPORTED_EMOJIS = ['👍', '❤️', '😄', '😢', '😡'];

// Define global constants for major UI elements
const SPLASH = document.querySelector("#splash"); // Splash page element
const LOGIN = document.querySelector("#login"); // Login page element
const PROFILE = document.querySelector("#profile"); // Profile page element
const APP = document.querySelector("#app"); // Main app layout element
const MESSAGES_CONTAINER = document.querySelector("#messagesContainer"); // Messages container
const REPLIES_CONTAINER = document.querySelector("#repliesContainer"); // Replies container

// Utility function: Show only top-level element
const showOnly = (element) => {
    SPLASH.classList.add("hide");
    LOGIN.classList.add("hide");
    PROFILE.classList.add("hide");
    APP.classList.add("hide");
    MESSAGES_CONTAINER.classList.add("hide");
    REPLIES_CONTAINER.classList.add("hide");
    element.classList.remove("hide");
};

function showChannels() {
    document.querySelector('#channelListContainer').classList.remove('hide');
    MESSAGES_CONTAINER.classList.add('hide');
    REPLIES_CONTAINER.classList.add('hide');
}

function showMessages() {
    document.querySelector('#channelListContainer').classList.add('hide');
    MESSAGES_CONTAINER.classList.remove('hide');
    REPLIES_CONTAINER.classList.add('hide');
}

function showReplies() {
    document.querySelector('#channelListContainer').classList.add('hide');
    MESSAGES_CONTAINER.classList.add('hide');
    REPLIES_CONTAINER.classList.remove('hide');
}

// Check if user is logged in
function isLoggedIn() {
    return localStorage.getItem(CNETID_KEY) != null;
}

// Save redirect path for post-login navigation
const saveRedirect = (path) => {
    localStorage.setItem('redirect_path', path);
};

// Handle redirects after login/signup
const handleRedirectAfterAuth = () => {
    const redirectPath = localStorage.getItem('redirect_path');
    if (redirectPath) {
        localStorage.removeItem('redirect_path');
        window.history.pushState({}, "", redirectPath);
        showOnly(APP);
        router();
    } else {
        window.history.pushState({}, "", "/");
        router();
    }
};

// Signup function
const signupUser = async () => {
    const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    if (response.ok) {
        alert(`Your account has been created. Username: ${data.name}, Password: ${data.password}`);
        localStorage.setItem(CNETID_KEY, data.api_key);
        handleRedirectAfterAuth();
    } else {
        console.error(data.error);
    }
};

// Login function
const loginUser = async () => {
    const username = document.querySelector("#login_username").value;
    const password = document.querySelector("#login_password").value;

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
        localStorage.setItem(CNETID_KEY, data.api_key);
        handleRedirectAfterAuth();
    } else {
        document.querySelector(".failed").style.display = "block";
        console.error(data.error);
    }
};

// Logout function
const logoutUser = () => {
    localStorage.removeItem(CNETID_KEY);
    window.location.reload();
};

// Create a new channel
const postChannel = async () => {
    const channelName = prompt("Enter the channel name:");
    if (!channelName) {
        alert("Channel name is required!");
        return;
    }

    const response = await fetch('/api/channels', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`
        },
        body: JSON.stringify({ name: channelName })
    });

    if (response.ok) {
        const newChannel = await response.json();
        console.log("Channel created:", newChannel);
        await loadChannels(); // Refresh channel list
    } else {
        const error = await response.json();
        console.error("Failed to create channel:", error.error);
        alert(`Error: ${error.error}`);
    }
};

// Fetch all channels to #channelList
const loadChannels = async () => {
    const response = await fetch('/api/channels', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`
        }
    });

    if (response.ok) {
        const channels = await response.json();
        console.log("Channels fetched:", channels);

        const channelList = document.querySelector("#channelList");
        channelList.innerHTML = channels.map(channel => `
            <div class="channel-item" onclick="enterChannel(${channel.id})">
                #${channel.name} (${channel.unread_count} unread)
            </div>
        `).join('');
    } else {
        console.error("Failed to fetch channels.");
    }
};

// Enter a channel and load its messages
const enterChannel = async (channelId) => {
    window.history.pushState({}, "", `/channels/${channelId}`);
    router();
};

// Fetch messages for a selected channel and populate #messagesContent
const loadChannel = async (channelId) => {
    const response = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`
        }
    });

    if (response.ok) {
        const messages = await response.json();
        console.log("Channel messages fetched:", messages);
        renderChannelMessages(messages);
        // Mark channel as read
        if (messages.length > 0) {
            const lastMsgId = messages[messages.length - 1].id;
            markChannelRead(channelId, lastMsgId);
        }
    } else {
        console.error("Failed to load channel.");
    }
};

// Mark channel as read
const markChannelRead = async (channelId, lastMsgId) => {
    await fetch(`/api/channels/${channelId}/read`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ last_read_message_id: lastMsgId })
    });
};

// Parse images in message text
function parseImages(text) {
    const imgRegex = /(https?:\/\/\S+\.(?:png|jpg|gif))/gi;
    let matches = text.match(imgRegex);
    let result = text;
    if (matches) {
        // Remove URLs from text and append images at the end
        matches.forEach(url => {
            result = result.replace(url, '');
        });
        result = result.trim();
        matches.forEach(url => {
            result += `<br><img src="${url}" alt="Image" style="max-width:200px;">`;
        });
    }
    return result;
}

// Render reactions
function renderReactions(message) {
    let html = `<div class="reactions">`;
    // Existing reactions
    if (message.reactions) {
        for (let emoji in message.reactions) {
            const count = message.reactions[emoji];
            html += `<span class="reaction" data-emoji="${emoji}" data-msgid="${message.id}" onmouseover="showReactionUsers(this, ${message.id}, '${emoji}')">${emoji} ${count}</span>`;
        }
    }
    // Add new reaction buttons
    SUPPORTED_EMOJIS.forEach(e => {
        html += `<button class="add-reaction" onclick="addReaction(${message.id}, '${e}')">${e}</button>`;
    });
    html += `</div>`;
    return html;
}

// Show reaction users tooltip: https://stackoverflow.com/questions/64397700/how-to-get-id-of-a-message-that-user-is-reacting-to-discord-py
// tooltip reference: https://stackoverflow.com/questions/78095546/how-to-use-tooltip-in-react
async function showReactionUsers(el, messageId, emoji) {
    
    // if we need the data again, fetch it. Or store after fetch:
    const rect = el.getBoundingClientRect();
    
    // assume we have a global store last loaded messages in a variable:
    let msg = window.lastLoadedMessages.find(m => m.id === messageId);
    if (msg && msg.reactors_for_each_emoji && msg.reactors_for_each_emoji[emoji]) {
        const users = msg.reactors_for_each_emoji[emoji].join(', ');
        // Show a simple alert for demo
        console.log(`Users who reacted with ${emoji}: ${users}`);
    }
}

// Add reaction to a message
async function addReaction(messageId, emoji) {
    const response = await fetch(`/api/messages/${messageId}/reactions`, {
        method:'POST',
        headers:{
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`,
            'Content-Type':'application/json'
        },
        body: JSON.stringify({ emoji })
    });
    if (response.ok) {
        // Reload current channel or thread
        if (CURRENT_ROOM) {
            await loadChannel(CURRENT_ROOM);
        } else {
            // If in thread, reload thread
            const path = window.location.pathname;
            if (path.startsWith("/messages/")) {
                const messageId = path.split("/").pop();
                await loadThread(messageId);
            }
        }
    }
}

// Render messages for the channel
const renderChannelMessages = (messages) => {
    window.lastLoadedMessages = messages;
    const messagesContent = document.querySelector("#messagesContent");
    const html = messages.map(msg => {
        let textWithImages = parseImages(msg.text);

        return `
        <div class="message" data-id="${msg.id}">
            <strong>${msg.username}</strong>: ${textWithImages}
            ${msg.replies_count > 0 ? `<div class="reply-count">${msg.replies_count} replies <button onclick="openThread(${msg.id})">View Replies</button></div>` : `<button onclick="openThread(${msg.id})">Reply</button>`}
            ${renderReactions(msg)}
        </div>
    `}).join('');
    messagesContent.innerHTML = html;
};

// Post a new message
const postMessage = async (channelId, text, parentId = null) => {
    if (!text) {
        alert("Message text is required!");
        return;
    }

    const response = await fetch(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`
        },
        body: JSON.stringify({ text, parent_id: parentId })
    });

    if (response.ok) {
        const newMessage = await response.json();
        console.log("Message posted:", newMessage);

        if (parentId) {
            // Reload the thread if it's a reply
            await loadThread(parentId);
        } else {
            // Reload the channel messages
            await loadChannel(channelId);
        }
    } else {
        const error = await response.json();
        console.error("Failed to post message:", error.error);
        alert(`Error: ${error.error}`);
    }
};

// Send message to the backend
const sendMessage = () => {
    const messageInput = document.querySelector("#newMessage");
    const messageText = messageInput.value.trim();

    if (!messageText) {
        alert("Message text is required!");
        return;
    }

    if (!CURRENT_ROOM) {
        alert("Please select a channel first!");
        return;
    }

    postMessage(CURRENT_ROOM, messageText);
    messageInput.value = ""; // Clear the input after sending
};

// Load a thread (replies)
const loadThread = async (messageId) => {
    const response = await fetch(`/api/messages/${messageId}/replies`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`
        }
    });

    if (response.ok) {
        const replies = await response.json();
        renderThreadReplies(replies);
    } else {
        console.error("Failed to load thread.");
    }
};

// Render replies for a thread
const renderThreadReplies = (replies) => {
    window.lastLoadedReplies = replies;
    const repliesContent = document.querySelector("#repliesContent");
    const html = replies.map(reply => {
        let textWithImages = parseImages(reply.text);
        return `
        <div class="reply" data-id="${reply.id}">
            <strong>${reply.username}</strong>: ${textWithImages}
            ${renderReactions(reply)}
        </div>
        `;
    }).join('');
    repliesContent.innerHTML = html;
};

// Open thread
const openThread = (messageId) => {
    CURRENT_THREAD_PARENT_ID = messageId; // Store parent message ID
    window.history.pushState({}, "", `/messages/${messageId}`);
    router();
};

// Create a new reply
const sendReply = () => {
    const replyInput = document.querySelector("#newReply");
    const replyText = replyInput.value.trim();
    if (!replyText) {
        alert("Reply text is required!");
        return;
    }

    if (!CURRENT_ROOM || !CURRENT_THREAD_PARENT_ID) {
        alert("Cannot post a reply without a room and parent message!");
        return;
    }

    // Post a message with parent_id = CURRENT_THREAD_PARENT_ID
    postMessage(CURRENT_ROOM, replyText, CURRENT_THREAD_PARENT_ID);
    replyInput.value = ""; // Clear the input after sending
};


// Close replies panel
document.querySelector(".close-replies").addEventListener("click", function() {
    showMessages();
    if (CURRENT_ROOM) {
        window.history.pushState({}, "", `/channels/${CURRENT_ROOM}`);
    } else {
        window.history.pushState({}, "", "/");
    }
});

// Start/Stop message polling for the current channel
function startMessagePolling() {
    if (TIMER_ID) {
        clearInterval(TIMER_ID);
    }
    TIMER_ID = setInterval(() => {
        if (CURRENT_ROOM) {
            loadChannel(CURRENT_ROOM);
        }
    }, 500);
    console.log("Message polling started.");
}

function stopMessagePolling() {
    if (TIMER_ID) {
        clearInterval(TIMER_ID);
        TIMER_ID = null;
    }
    console.log("Message polling stopped.");
}

// Start/Stop unread counts polling
function startUnreadCountsPolling() {
    if (UNREAD_TIMER_ID) {
        clearInterval(UNREAD_TIMER_ID);
    }
    UNREAD_TIMER_ID = setInterval(fetchUnreadCounts, 1000);
    console.log("Unread counts polling started.");
}

function stopUnreadCountsPolling() {
    if (UNREAD_TIMER_ID) {
        clearInterval(UNREAD_TIMER_ID);
        UNREAD_TIMER_ID = null;
    }
    console.log("Unread counts polling stopped.");
}

// Fetch unread counts and update channel list
async function fetchUnreadCounts() {
    const response = await fetch('/api/unread_counts', {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem(CNETID_KEY)}`
        }
    });

    if (response.ok) {
        const data = await response.json();
        const channel_unreads = data.channel_unreads;
        // Update channel list if currently visible
        const channelList = document.querySelector("#channelList");
        if (channelList && channelList.children.length > 0) {
            // Re-fetch channels to update UI properly or map channel_unreads
            await loadChannels();
        }
    }
}

// Profile Navigation
function goToProfile() {
    window.history.pushState({}, "", "/profile");
    router();
}

function goToApp() {
    window.history.pushState({}, "", "/");
    router();
}

// Update Username
const updateUsername = async () => {
    const newUsername = document.querySelector("#profile input[name='username']").value.trim();
    if (!newUsername) {
        alert("Username is required!");
        return;
    }

    const response = await fetch("/api/user/name", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${localStorage.getItem(CNETID_KEY)}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username: newUsername })
    });
    const data = await response.json();
    if (response.ok) {
        alert("Username updated successfully.");
    } else {
        alert(data.error || "Failed to update username");
    }
};

// Update Password
const updatePassword = async () => {
    const passwordField = document.querySelector("#profile input[name='password']");
    const repeatPasswordField = document.querySelector("#profile input[name='repeatPassword']");

    const newPassword = passwordField.value.trim();
    const repeatPassword = repeatPasswordField.value.trim();

    if (!newPassword || !repeatPassword) {
        alert("Both password fields are required!");
        return;
    }

    if (newPassword !== repeatPassword) {
        alert("Passwords do not match!");
        return;
    }

    const response = await fetch("/api/user/password", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${localStorage.getItem(CNETID_KEY)}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ password: newPassword })
    });

    const data = await response.json();
    if (response.ok) {
        alert("Password updated successfully.");
        passwordField.value = "";
        repeatPasswordField.value = "";
    } else {
        alert(data.error || "Failed to update password");
    }
};

// Router function to manage navigation and state
const router = async () => {
    const path = window.location.pathname;
    stopMessagePolling(); // Always stop polling first
    // startUnreadCountsPolling or stop based on auth
    if (!isLoggedIn()) {
        stopUnreadCountsPolling();
    } else {
        startUnreadCountsPolling();
    }

    if (path === "/") {
        // If logged in, show app and load channels
        if (isLoggedIn()) {
            await loadChannels();
            showOnly(APP);
            showChannels();
        } else {
            // Show splash if not logged in
            showOnly(SPLASH);
        }
    } else if (path === "/login" || path === "/signup") {
        if (isLoggedIn()) {
            window.history.pushState({}, "", "/");
            router();
        } else {
            showOnly(LOGIN);
        }
    } else if (path === "/profile") {
        if (!isLoggedIn()) {
            saveRedirect(path);
            window.history.pushState({}, "", "/login");
            showOnly(LOGIN);
        } else {
            showOnly(PROFILE);
        }
    } else if (path.startsWith("/channels/")) {
        const channelId = path.split("/").pop();
        if (!isLoggedIn()) {
            saveRedirect(path);
            window.history.pushState({}, "", "/login");
            showOnly(LOGIN);
        } else {
            CURRENT_ROOM = channelId;
            await loadChannel(channelId);
            showOnly(APP);
            showMessages();
            startMessagePolling();
        }
    } else if (path.startsWith("/messages/")) {
        const messageId = path.split("/").pop();
        if (!isLoggedIn()) {
            saveRedirect(path);
            window.history.pushState({}, "", "/login");
            showOnly(LOGIN);
        } else {
            await loadThread(messageId);
            showOnly(APP);
            showReplies();
        }
    } else {
        // Default fallback
        window.history.pushState({}, "", "/");
        router();
    }
};

// Initialize app and handle initial routing
window.addEventListener("DOMContentLoaded", () => {
    router();
});

// Handle browser back/forward navigation
window.addEventListener("popstate", router);
