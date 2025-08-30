/// <reference path="./roll20.d.ts" />

// Example Roll20 API script to validate IntelliSense and provide a starting point
on('ready', () => {
  log('Roll20 script: ready');
});

/**
 * Chat command handler
 * @param {ChatMessage} msg
 */
on('chat:message', (msg) => {
  if (msg.type !== 'api') return;

  const parts = msg.content.trim().split(/\s+/);
  const command = parts.shift();

  if (command === '!ping') {
    sendChat('PingBot', `/w "${msg.who}" Pong! ${randomInteger(100)}`);
  }
});

