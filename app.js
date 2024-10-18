import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from 'https://cdn.skypack.dev/@aws-sdk/client-bedrock-runtime';
import { SignatureV4 } from 'https://cdn.skypack.dev/@aws-sdk/signature-v4';
import { Sha256 } from 'https://cdn.skypack.dev/@aws-crypto/sha256-browser';

let db;
let currentConversationId;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ChatApp', 1);

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            db = event.target.result;
            const objectStore = db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
            objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        };
    });
}

function saveCredentials() {
    const accessKey = document.getElementById('accessKey').value;
    const secretKey = document.getElementById('secretKey').value;
    const region = document.getElementById('region').value;

    if (!accessKey || !secretKey || !region) {
        alert('Please fill in all fields');
        return;
    }

    localStorage.setItem('awsCredentials', JSON.stringify({ accessKey, secretKey, region }));
    closeSettingsModal();
    alert('Credentials saved!');
}

function getCredentials() {
    const credentials = localStorage.getItem('awsCredentials');
    return credentials ? JSON.parse(credentials) : null;
}

function openSettingsModal() {
    document.getElementById('settingsModal').classList.remove('hidden');
    const credentials = getCredentials();
    if (credentials) {
        document.getElementById('accessKey').value = credentials.accessKey;
        document.getElementById('secretKey').value = credentials.secretKey;
        document.getElementById('region').value = credentials.region;
    }
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
}

function checkCredentials() {
    const credentials = getCredentials();
    if (!credentials) {
        openSettingsModal();
    }
}

async function sendMessage() {
    const credentials = getCredentials();
    if (!validateCredentials(credentials)) return;

    const userInput = getUserInput();
    if (!userInput) return;

    updateUIWithUserMessage(userInput);
    await updateConversationWithUserMessage(userInput);

    const client = createBedrockClient(credentials);
    const conversation = await getUpdatedConversation();
    const params = createModelParams(conversation);

    try {
        const assistantResponse = await invokeModel(client, params);
        await updateConversationWithAssistantResponse(assistantResponse);
        logFinalConversationState();
    } catch (error) {
        handleModelError(error);
    }
}

function validateCredentials(credentials) {
    if (!credentials) {
        alert('Please save your AWS credentials first.');
        return false;
    }
    return true;
}

function getUserInput() {
    const userInput = document.getElementById('userInput').value.trim();
    return userInput ? userInput : null;
}

function updateUIWithUserMessage(userInput) {
    updateChatHistory('user', userInput);
    const userInputElement = document.getElementById('userInput');
    userInputElement.value = '';
    resetTextareaHeight(userInputElement);
}

function resetTextareaHeight(textarea) {
    textarea.style.height = 'auto';
    const minRows = 3;
    const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight);
    textarea.style.height = `${lineHeight * minRows}px`;
}

async function updateConversationWithUserMessage(userInput) {
    await updateConversation(currentConversationId, { role: 'user', content: userInput });
}

function createBedrockClient(credentials) {
    return new BedrockRuntimeClient({
        region: credentials.region,
        credentials: {
            accessKeyId: credentials.accessKey,
            secretAccessKey: credentials.secretKey
        },
        signer: new SignatureV4({
            credentials: {
                accessKeyId: credentials.accessKey,
                secretAccessKey: credentials.secretKey
            },
            region: credentials.region,
            service: 'bedrock',
            sha256: Sha256
        })
    });
}

async function getUpdatedConversation() {
    const updatedConversation = await getConversation(currentConversationId);
    console.log("Updated conversation after user input:", updatedConversation);
    return updatedConversation;
}

function createModelParams(conversation) {
    const messages = conversation.messages.map(msg => ({ role: msg.role, content: msg.content }));
    const systemPrompt = document.getElementById('systemPrompt').value;
    return {
        modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 8192,
            messages: messages,
            temperature: 0.3,
            top_p: 1,
            system: systemPrompt
        })
    };
}

async function invokeModel(client, params) {
    const command = new InvokeModelWithResponseStreamCommand(params);
    const response = await client.send(command);
    let assistantResponse = '';
    let messageElement = null;

    for await (const chunk of response.body) {
        try {
            const parsed = parseChunk(chunk);
            if (parsed.type === 'content_block_delta') {
                assistantResponse += parsed.delta.text;
                const parsedContent = marked.parse(assistantResponse);
                const highlightedContent = highlightCode(parsedContent);
                messageElement = updateChatHistory('assistant', highlightedContent, true, messageElement);
            }
        } catch (e) {
            console.error('Error parsing chunk:', e);
        }
    }

    return assistantResponse;
}

function highlightCode(content) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    tempDiv.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    return tempDiv.innerHTML;
}

function parseChunk(chunk) {
    const uint8Array = chunk.chunk.bytes;
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(uint8Array);
    return JSON.parse(jsonString);
}

async function updateConversationWithAssistantResponse(assistantResponse) {
    await updateConversation(currentConversationId, { role: 'assistant', content: assistantResponse });
}

async function logFinalConversationState() {
    const finalConversation = await getConversation(currentConversationId);
    console.log("Final conversation state:", finalConversation);
}

function handleModelError(error) {
    console.error('Error:', error);
    updateChatHistory('system', 'An error occurred. Please check the console for details.');
}


async function createNewConversation(existingConversation = null) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['conversations'], 'readwrite');
        const objectStore = transaction.objectStore('conversations');
        const newConversation = existingConversation || { timestamp: Date.now(), messages: [] };
        console.log(newConversation);
        const request = objectStore.add(newConversation);

        request.onsuccess = (event) => {
            const newConversationId = event.target.result;
            currentConversationId = newConversationId;
            if (!existingConversation) {
                document.getElementById('chatHistory').innerHTML = '';
                // Focus on the text chat input
                document.getElementById('userInput').focus();
                // Scroll to the bottom of the chat history
                const chatHistory = document.getElementById('chatHistory');
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }
            console.log('New conversation created with ID:', newConversationId);
            resolve(newConversationId);
        };

        request.onerror = (event) => {
            console.error('Error creating new conversation:', event.target.error);
            reject(event.target.error);
        };
    });
}

async function getConversation(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['conversations'], 'readonly');
        const objectStore = transaction.objectStore('conversations');
        const request = objectStore.get(id);

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}


async function loadConversations() {
    const transaction = db.transaction(['conversations'], 'readwrite');
    const objectStore = transaction.objectStore('conversations');
    const index = objectStore.index('timestamp');
    const request = index.openCursor(null, 'prev');

    const conversationList = document.getElementById('conversationList');
    conversationList.innerHTML = '';

    const deleteEmptyConversations = [];
    let hasNonEmptyConversations = false;
    let firstNonEmptyConversation = null;

    request.onsuccess = async (event) => {
        const cursor = event.target.result;
        if (cursor) {
            const conversation = cursor.value;
            console.log('Loading conversation:', conversation);
            if (conversation.messages.length === 0) {
                deleteEmptyConversations.push(conversation.id);
            } else {
                hasNonEmptyConversations = true;
                if (!firstNonEmptyConversation) {
                    firstNonEmptyConversation = conversation;
                }
                const firstUserMessage = conversation.messages.find(msg => msg.role === 'user');
                const preview = firstUserMessage ? firstUserMessage.content.substring(0, 100) + '...' : 'Empty conversation';

                const li = document.createElement('li');
                li.className = 'conversation-item p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded text-gray-800 dark:text-gray-200 flex justify-between items-center';
                li.innerHTML = `
                    <span>${preview}</span>
                    <i class="delete-icon bi bi-trash text-red-500 hover:text-red-700 cursor-pointer"></i>
                `;
                li.onclick = (e) => {
                    if (!e.target.classList.contains('delete-icon')) {
                        displayConversation(conversation);
                    }
                };
                li.querySelector('.delete-icon').onclick = (e) => {
                    e.stopPropagation();
                    deleteConversation(conversation.id);
                };
                conversationList.appendChild(li);
            }
            cursor.continue();
        } else {
            console.log('Finished loading conversations');
            // Delete empty conversations after the cursor is done
            for (const id of deleteEmptyConversations) {
                await new Promise((resolve, reject) => {
                    const deleteRequest = objectStore.delete(id);
                    deleteRequest.onsuccess = resolve;
                    deleteRequest.onerror = (event) => {
                        console.error('Error deleting empty conversation:', event.target.error);
                        reject(event.target.error);
                    };
                });
            }
            
            // Create a new conversation only if there are no non-empty conversations
            if (!hasNonEmptyConversations) {
                console.log('No non-empty conversations found, creating a new one');
                const newConversationId = await createNewConversation();
                const newConversation = await getConversation(newConversationId);
                displayConversation(newConversation);
            } else if (!currentConversationId && firstNonEmptyConversation) {
                console.log('Displaying first non-empty conversation');
                // If there's no current conversation, display the first non-empty one
                displayConversation(firstNonEmptyConversation);
            }
        }
    };

    request.onerror = (event) => {
        console.error('Error loading conversations:', event.target.error);
    };
}

async function getFirstConversation() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['conversations'], 'readonly');
        const objectStore = transaction.objectStore('conversations');
        const index = objectStore.index('timestamp');
        const request = index.openCursor(null, 'prev');

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                resolve(cursor.value);
            } else {
                resolve(null);
            }
        };

        request.onerror = (event) => {
            console.error('Error getting first conversation:', event.target.error);
            reject(event.target.error);
        };
    });
}

function deleteConversation(id) {
    const transaction = db.transaction(['conversations'], 'readwrite');
    const objectStore = transaction.objectStore('conversations');
    const request = objectStore.delete(id);

    request.onsuccess = () => {
        console.log('Conversation deleted successfully');
        if (currentConversationId === id) {
            currentConversationId = null;
            document.getElementById('chatHistory').innerHTML = '';
        }
        loadConversations();
    };

    request.onerror = (event) => {
        console.error('Error deleting conversation:', event.target.error);
    };
}

function displayConversation(conversation) {
    currentConversationId = conversation.id;
    const chatHistory = document.getElementById('chatHistory');
    chatHistory.innerHTML = '';
    conversation.messages.forEach(message => {
        let content = message.content;
        if (message.role === 'assistant') {
            content = marked.parse(content);
            content = highlightCode(content);
        }
        updateChatHistory(message.role, content);
    });
    // Scroll to the bottom of the chat history
    chatHistory.scrollTop = chatHistory.scrollHeight;
    // Close the sidebar on mobile after selecting a conversation
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('translate-x-0');
    }
}

// Add event listeners after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    checkCredentials();
    await loadConversations();

    const elements = {
        openSettingsBtn: document.getElementById('openSettingsBtn'),
        closeSettingsBtn: document.getElementById('closeSettingsBtn'),
        saveCredentialsBtn: document.getElementById('saveCredentialsBtn'),
        newConversationBtn: document.getElementById('newConversationBtn'),
        sendMessageBtn: document.getElementById('sendMessageBtn'),
        settingsModal: document.getElementById('settingsModal'),
        userInput: document.getElementById('userInput'),
        toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
        sidebar: document.getElementById('sidebar')
    };

    // Initialize the textarea height
    if (elements.userInput) {
        resetTextareaHeight(elements.userInput);
    }

    function onNewConversationClick(event) {
        createNewConversation().then(newConversationId => {
            getConversation(newConversationId).then(newConversation => {
                displayConversation(newConversation);
            });
        });
    }

    // Check if all elements exist before adding event listeners
    if (elements.openSettingsBtn) {
        elements.openSettingsBtn.addEventListener('click', openSettingsModal);
    }
    if (elements.closeSettingsBtn) {
        elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    }
    if (elements.saveCredentialsBtn) {
        elements.saveCredentialsBtn.addEventListener('click', saveCredentials);
    }
    if (elements.newConversationBtn) {
        elements.newConversationBtn.addEventListener('click', onNewConversationClick);
    }
    if (elements.sendMessageBtn) {
        elements.sendMessageBtn.addEventListener('click', sendMessage);
    }

    // Close modal when clicking outside
    if (elements.settingsModal) {
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) {
                closeSettingsModal();
            }
        });
    }

    // Handle Enter key to send message and Shift+Enter for new line
    if (elements.userInput) {
        elements.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (elements.userInput.value.trim()) {
                    sendMessage();
                }
            }
        });
        
        // Add event listener for input to handle auto-resizing
        elements.userInput.addEventListener('input', autoResizeTextarea);
        
        // Initial call to set correct height
        autoResizeTextarea.call(elements.userInput);
    }

    // Mobile sidebar toggle
    if (elements.toggleSidebarBtn && elements.sidebar) {
        elements.toggleSidebarBtn.addEventListener('click', () => {
            elements.sidebar.classList.toggle('translate-x-0');
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && !elements.sidebar.contains(e.target) && !elements.toggleSidebarBtn.contains(e.target)) {
                elements.sidebar.classList.remove('translate-x-0');
            }
        });
    }

    // Adjust layout when virtual keyboard appears
    window.addEventListener('resize', () => {
        if (window.innerHeight < 600) { // Assuming the keyboard is open
            document.body.classList.add('keyboard-open');
        } else {
            document.body.classList.remove('keyboard-open');
        }
    });
});

function autoResizeTextarea() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    
    const maxRows = parseInt(this.getAttribute('data-max-rows') || 15);
    const lineHeight = parseInt(window.getComputedStyle(this).lineHeight);
    const maxHeight = lineHeight * maxRows;
    
    if (this.scrollHeight > maxHeight) {
        this.style.height = maxHeight + 'px';
        this.style.overflowY = 'auto';
    } else {
        this.style.overflowY = 'hidden';
    }
    
    // Ensure minimum height of 3 lines
    const minHeight = lineHeight * 3;
    if (parseInt(this.style.height) < minHeight) {
        this.style.height = minHeight + 'px';
    }
}

// Update the updateChatHistory function to create message bubbles and handle streaming with markdown
function updateChatHistory(role, content, isStreaming = false, existingElement = null) {
    const chatHistory = document.getElementById('chatHistory');
    let messageElement = existingElement;

    if (!messageElement) {
        messageElement = document.createElement('div');
        messageElement.className = 'mb-4 w-full relative';
        messageElement.dataset.role = role;
        const bubble = document.createElement('div');
        bubble.className = `p-3 rounded-lg ${
            role === 'user' 
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' 
                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
        } ${role === 'user' ? 'user-content' : 'markdown-content'}`;
        messageElement.appendChild(bubble);

        if (role === 'user') {
            const trashIcon = document.createElement('button');
            trashIcon.className = 'absolute top-2 right-2 text-gray-500 hover:text-red-500 transition-colors duration-200';
            trashIcon.innerHTML = '<i class="bi bi-trash"></i>';
            trashIcon.onclick = () => deleteMessageAndSubsequent(messageElement);
            messageElement.appendChild(trashIcon);
        } else if (role === 'assistant') {
            const clipboardIcon = document.createElement('button');
            clipboardIcon.className = 'absolute top-2 right-2 text-gray-500 hover:text-blue-500 transition-colors duration-200';
            clipboardIcon.innerHTML = '<i class="bi bi-clipboard"></i>';
            clipboardIcon.onclick = () => copyToClipboard(content);
            messageElement.appendChild(clipboardIcon);
        }

        chatHistory.appendChild(messageElement);
    }

    const bubble = messageElement.querySelector(role === 'user' ? '.user-content' : '.markdown-content');
    
    if (role === 'user') {
        // Escape HTML and preserve newlines for user messages
        const escapedContent = escapeHtml(content);
        bubble.innerHTML = escapedContent.replace(/\n/g, '<br>');
        bubble.style.whiteSpace = 'pre-wrap';
    } else {
        // For assistant messages, we directly set the HTML content
        // as it's already been parsed by marked in displayConversation
        bubble.innerHTML = content;
    }

    chatHistory.scrollTop = chatHistory.scrollHeight;

    return messageElement;
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function copyToClipboard(text) {
    // Remove HTML tags from the text
    const tempElement = document.createElement('div');
    tempElement.innerHTML = text;
    const plainText = tempElement.textContent || tempElement.innerText;

    navigator.clipboard.writeText(plainText).then(() => {
        alert('Message copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

async function deleteMessageAndSubsequent(messageElement) {
    if (!confirm('Are you sure you want to delete this message and all subsequent messages?')) {
        return;
    }

    const chatHistory = document.getElementById('chatHistory');
    let currentElement = messageElement;
    let messagesToDelete = [];

    while (currentElement) {
        messagesToDelete.push(currentElement);
        currentElement = currentElement.nextElementSibling;
    }

    messagesToDelete.forEach(el => chatHistory.removeChild(el));

    // Update the conversation in the database
    const conversation = await getConversation(currentConversationId);
    const messageIndex = Array.from(chatHistory.children).indexOf(messageElement);
    conversation.messages = conversation.messages.slice(0, messageIndex-3);

    await updateConversation(currentConversationId, null, conversation.messages);
}

// Update the updateConversation function to accept a messages array
async function updateConversation(id, message = null, messages = null) {
    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction(['conversations'], 'readwrite');
        const objectStore = transaction.objectStore('conversations');

        const getRequest = objectStore.get(id);

        getRequest.onsuccess = (event) => {
            const conversation = event.target.result;
            if (message) {
                conversation.messages.push(message);
            } else if (messages) {
                conversation.messages = messages;
            }

            const putRequest = objectStore.put(conversation);

            putRequest.onsuccess = () => {
                console.log('Conversation updated successfully');
                resolve(conversation);
            };

            putRequest.onerror = (event) => {
                console.error('Error updating conversation:', event.target.error);
                reject(event.target.error);
            };
        };

        getRequest.onerror = (event) => {
            console.error('Error retrieving conversation:', event.target.error);
            reject(event.target.error);
        };

        transaction.oncomplete = () => {
            console.log('Transaction completed: database modification finished.');
        };
    });
}

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;

const microphoneBtn = document.getElementById('microphoneBtn');
const userInput = document.getElementById('userInput');

let isListening = false;

microphoneBtn.addEventListener('click', () => {
    if (!isListening) {
        recognition.start();
        microphoneBtn.classList.add('active');
        isListening = true;
    } else {
        recognition.stop();
        microphoneBtn.classList.remove('active');
        isListening = false;
    }
});

let lastTranscript = '';

recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
            finalTranscript += transcript;
        } else {
            interimTranscript += transcript;
        }
    }

    // Only update the input if the transcript has changed
    if (finalTranscript !== lastTranscript) {
        // Replace the entire input value with the new transcript
        userInput.value = finalTranscript;
        lastTranscript = finalTranscript;
    }

    // Trim leading/trailing spaces and remove double spaces
    userInput.value = userInput.value.trim().replace(/\s+/g, ' ');

    // Show send button if there's text
    if (userInput.value.trim()) {
        sendMessageBtn.classList.remove('hidden');
    } else {
        sendMessageBtn.classList.add('hidden');
    }
};

recognition.onerror = (event) => {
    console.error('Speech recognition error', event.error);
    microphoneBtn.classList.remove('bg-red-500');
    microphoneBtn.classList.add('bg-gray-300');
    isListening = false;
};

recognition.onend = () => {
    microphoneBtn.classList.remove('active');
    isListening = false;
};


function setColorScheme(scheme) {
    if (scheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

function saveSystemPrompt() {
    const systemPrompt = document.getElementById('systemPrompt').value;
    localStorage.setItem('systemPrompt', systemPrompt);
}

function loadSystemPrompt() {
    const savedSystemPrompt = localStorage.getItem('systemPrompt');
    if (savedSystemPrompt) {
        document.getElementById('systemPrompt').value = savedSystemPrompt;
    }
}


function setupBackupRestore() {
    document.getElementById('backupBtn').addEventListener('click', backupIndexedDB);
    document.getElementById('restoreInput').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            restoreIndexedDB(file);
        }
    });
}

async function backupIndexedDB() {
    const exportObject = {
        conversations: await getAllConversations(),
        systemPrompt: document.getElementById('systemPrompt').value
    };

    const blob = new Blob([JSON.stringify(exportObject)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chatapp-backup.json';
    a.click();
}

async function restoreIndexedDB(file) {
    const reader = new FileReader();

    reader.onload = async (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            console.log('Imported data:', importedData);
            
            // Restore conversations
            await clearAllConversations();
            for (let conversation of importedData.conversations) {
                console.log('Restoring conversation:', conversation);
                await createNewConversation(conversation);
            }
            
            // Restore system prompt
            if (importedData.systemPrompt) {
                document.getElementById('systemPrompt').value = importedData.systemPrompt;
                saveSystemPrompt();
                console.log('System prompt restored');
            }
            
            alert('Data restored successfully!');
            await loadConversations();
            console.log('Conversations loaded after restore');
            
            // Force a refresh of the conversation list
            const firstConversation = await getFirstConversation();
            if (firstConversation) {
                displayConversation(firstConversation);
                console.log('First conversation displayed');
            }
        } catch (error) {
            console.error('Error restoring data:', error);
            alert('Error restoring data. Please check the console for details.');
        }
    };

    reader.readAsText(file);
}

async function getAllConversations() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['conversations'], 'readonly');
        const objectStore = transaction.objectStore('conversations');
        const request = objectStore.getAll();

        request.onsuccess = (event) => {
            resolve(event.target.result);
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

async function clearAllConversations() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['conversations'], 'readwrite');
        const objectStore = transaction.objectStore('conversations');
        const request = objectStore.clear();

        request.onsuccess = () => {
            resolve();
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}



// Add event listener for system prompt changes
document.getElementById('systemPrompt').addEventListener('input', saveSystemPrompt);

// Load the system prompt when the page loads
document.addEventListener('DOMContentLoaded', () => {
    loadSystemPrompt();
    setupBackupRestore();
});

// Watch for system preference changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    setColorScheme(e.matches ? 'dark' : 'light');
});


// Check for saved color scheme preference or use the system preference
const savedScheme = localStorage.getItem('color-scheme');

if (savedScheme) {
    setColorScheme(savedScheme);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setColorScheme('dark');
}
