# Photo reader setup

1. Get an Anthropic API key at console.anthropic.com (add a few dollars of credit).
2. In Cloudflare, create a Worker, paste in worker.js, and add two secrets:
   - ANTHROPIC_API_KEY: the key from step 1
   - APP_PASSCODE: any passcode you choose
3. In Macro Log, open Settings, Photo reading, and enter the Worker address and the passcode.
