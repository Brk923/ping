// UrgencyBridge App Logic

// --- CONFIGURATION ---
// Replace with your Supabase project credentials
const SUPABASE_URL = 'https://uykjsldlgfjqfdimhyds.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5a2pzbGRsZ2ZqcWZkaW1oeWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NjMzOTEsImV4cCI6MjA4NzQzOTM5MX0.aCOzB736aZ2uWdumsa02byLJhefSwkld-uaaIcgsuoo';
// Replace with your EmailJS credentials
const EMAILJS_PUBLIC_KEY = 'fE_BKgW2Rj4cmJeGb';
const EMAILJS_SERVICE_ID = 'service_9czkl7q';
const EMAILJS_TEMPLATE_ID = 'template_kkcl64d';

let dbClient = null;
if (SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// --- STATE MANAGEMENT ---
let currentSession = null;
let currentProfile = null;

// --- DOM ELEMENTS ---
const sections = {
    search: document.getElementById('search-section'),
    register: document.getElementById('register-section'),
    chat: document.getElementById('chat-section')
};

const navBtns = {
    home: document.getElementById('nav-home'),
    register: document.getElementById('nav-register')
};

// --- NAVIGATION ---
function showSection(sectionId) {
    Object.values(sections).forEach(s => s.classList.remove('active'));
    sections[sectionId].classList.add('active');

    Object.values(navBtns).forEach(b => b.classList.remove('active'));
    if (sectionId === 'search') navBtns.home.classList.add('active');
    if (sectionId === 'register') navBtns.register.classList.add('active');
}

navBtns.home.addEventListener('click', () => showSection('search'));
navBtns.register.addEventListener('click', () => showSection('register'));

// --- REGISTRATION LOGIC ---
const regUniqueId = document.getElementById('new-unique-id');
const regEmail = document.getElementById('user-email');
const regBtn = document.getElementById('complete-registration');
const regStatus = document.getElementById('register-status');

regBtn.addEventListener('click', async () => {
    if (!dbClient) {
        regStatus.innerText = "Error: Supabase not configured.";
        regStatus.className = "status-msg error";
        return;
    }

    const uniqueId = regUniqueId.value.trim();
    const email = regEmail.value.trim();

    if (!uniqueId || !email) {
        regStatus.innerText = "Please fill all fields.";
        regStatus.className = "status-msg error";
        return;
    }

    regBtn.disabled = true;
    regStatus.innerText = "Registering...";

    try {
        const { data, error } = await dbClient
            .from('profiles')
            .insert([{ unique_id: uniqueId, email: email }])
            .select();

        if (error) throw error;

        regStatus.innerText = `Success! Your ID ${uniqueId} is active.`;
        regStatus.className = "status-msg success";
        regUniqueId.value = '';
        regEmail.value = '';
    } catch (err) {
        regStatus.innerText = `Error: ${err.message}`;
        regStatus.className = "status-msg error";
    } finally {
        regBtn.disabled = false;
    }
});

// --- TRIGGER ALERT LOGIC ---
const targetIdInput = document.getElementById('target-id');
const reasonInput = document.getElementById('urgency-reason');
const triggerBtn = document.getElementById('trigger-alert');
const searchStatus = document.getElementById('search-status');

triggerBtn.addEventListener('click', async () => {
    if (!dbClient) {
        searchStatus.innerText = "Error: Supabase not configured.";
        searchStatus.className = "status-msg error";
        return;
    }

    const targetId = targetIdInput.value.trim();
    const reason = reasonInput.value.trim();

    if (!targetId || !reason) {
        searchStatus.innerText = "Enter ID and Reason.";
        searchStatus.className = "status-msg error";
        return;
    }

    // --- Spam Protection (10 min check) ---
    const lastAlert = localStorage.getItem('last_alert_time');
    const now = Date.now();
    if (lastAlert && (now - lastAlert < 10 * 60 * 1000)) {
        const remaining = Math.ceil((10 * 60 * 1000 - (now - lastAlert)) / 60000);
        searchStatus.innerText = `Spam Protection: Please wait ${remaining} min.`;
        searchStatus.className = "status-msg error";
        return;
    }

    triggerBtn.disabled = true;
    searchStatus.innerText = "Locating recipient...";

    try {
        // 1. Find the profile
        const { data: profiles, error: pError } = await dbClient
            .from('profiles')
            .select('*')
            .eq('unique_id', targetId);

        if (pError || !profiles.length) throw new Error("ID not found.");
        const recipient = profiles[0];

        // 2. Create a session
        const { data: session, error: sError } = await dbClient
            .from('sessions')
            .insert([{
                recipient_id: recipient.id,
                urgency_reason: reason,
                status: 'pending'
            }])
            .select()
            .single();

        if (sError) throw sError;

        // Save alert time for spam protection
        localStorage.setItem('last_alert_time', Date.now());

        // 3. Send Email Alert (placeholder for EmailJS)
        await sendEmailAlert(recipient.email, targetId, reason, session.id);

        searchStatus.innerText = "Alert Sent! Entering the Bridge...";
        searchStatus.className = "status-msg success";

        // 4. Enter Chat
        enterChat(session, 'seeker');

    } catch (err) {
        searchStatus.innerText = `Error: ${err.message}`;
        searchStatus.className = "status-msg error";
        triggerBtn.disabled = false;
    }
});

async function sendEmailAlert(email, id, reason, sessionId) {
    if (EMAILJS_PUBLIC_KEY === 'YOUR_EMAILJS_PUBLIC_KEY') {
        console.log("EmailJS not configured. Simulated email to:", email);
        return;
    }

    const templateParams = {
        to_email: email,
        recipient_id: id,
        urgency_reason: reason,
        chat_link: `${window.location.origin}${window.location.pathname}?session=${sessionId}`
    };

    return emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, EMAILJS_PUBLIC_KEY);
}

// --- CHAT LOGIC ---
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-message');
const messagesArea = document.getElementById('chat-messages');
const chatWithLabel = document.getElementById('chat-with');
const endSessionBtn = document.getElementById('end-session');

let chatSubscription = null;
let sessionSubscription = null;
let userRole = null; // 'seeker' or 'recipient'

async function enterChat(session, role) {
    currentSession = session;
    userRole = role;
    showSection('chat');

    chatWithLabel.innerText = role === 'seeker' ? 'Waiting for Recipient...' : 'Bridge Active';
    messagesArea.innerHTML = `<div class="status-msg">Bridge established. Waiting for connection...</div>`;

    // 1. Fetch existing messages
    const { data: messages, error } = await dbClient
        .from('messages')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true });

    if (messages) {
        messages.forEach(msg => appendMessage(msg));
    }

    // 2. Subscribe to new messages
    chatSubscription = dbClient
        .channel(`chat-${session.id}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `session_id=eq.${session.id}`
        }, payload => {
            appendMessage(payload.new);
        })
        .subscribe();

    // 3. Subscribe to session status changes (for ending session)
    sessionSubscription = dbClient
        .channel(`session-${session.id}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'sessions',
            filter: `id=eq.${session.id}`
        }, payload => {
            if (payload.new.status === 'ended') {
                terminateLocalSession("Session ended by other party.");
            } else if (payload.new.status === 'active') {
                chatWithLabel.innerText = 'Connected';
            }
        })
        .subscribe();
}

function appendMessage(msg) {
    const div = document.createElement('div');
    div.classList.add('message', msg.sender_type);
    div.innerText = msg.content;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

sendBtn.addEventListener('click', async () => {
    const content = messageInput.value.trim();
    if (!content || !currentSession) return;

    messageInput.value = '';
    const { error } = await dbClient
        .from('messages')
        .insert([{
            session_id: currentSession.id,
            sender_type: userRole,
            content: content
        }]);

    if (error) console.error("Send error:", error);
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

endSessionBtn.addEventListener('click', async () => {
    if (!currentSession) return;

    if (confirm("End this urgent session and delete chat history?")) {
        const { error } = await dbClient
            .from('sessions')
            .update({ status: 'ended' })
            .eq('id', currentSession.id);

        if (!error) terminateLocalSession("Session terminated and wiped.");
    }
});

function terminateLocalSession(msg) {
    if (chatSubscription) dbClient.removeChannel(chatSubscription);
    if (sessionSubscription) dbClient.removeChannel(sessionSubscription);

    alert(msg);
    window.location.href = window.location.origin + window.location.pathname; // Clear URL params
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');

    if (sessionId && dbClient) {
        try {
            const { data: session, error } = await dbClient
                .from('sessions')
                .select('*')
                .eq('id', sessionId)
                .single();

            if (error || !session) throw new Error("Session not found or expired.");
            if (session.status === 'ended') throw new Error("This bridge has already been closed.");

            // Update session status to active if recipient joins
            await dbClient
                .from('sessions')
                .update({ status: 'active' })
                .eq('id', sessionId);

            enterChat(session, 'recipient');
        } catch (err) {
            alert(err.message);
            window.location.href = window.location.origin + window.location.pathname;
        }
    }
});
