const SQUARE_SCRIPT_ID = 'square-web-payments-sdk';
const SQUARE_PRODUCTION_SCRIPT_SRC = 'https://web.squarecdn.com/v1/square.js';
const SQUARE_SANDBOX_SCRIPT_SRC = 'https://sandbox.web.squarecdn.com/v1/square.js';

let squareScriptPromise;

function getSquareScriptSrc() {
  const configuredEnvironment = import.meta.env.VITE_SQUARE_ENVIRONMENT?.toLowerCase();
  const applicationId = import.meta.env.VITE_SQUARE_APPLICATION_ID || '';
  const isSandbox = configuredEnvironment === 'sandbox'
    || (configuredEnvironment !== 'production' && applicationId.startsWith('sandbox-'));

  return isSandbox ? SQUARE_SANDBOX_SCRIPT_SRC : SQUARE_PRODUCTION_SCRIPT_SRC;
}

export function loadSquareWebPaymentsSdk() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Square Web Payments SDK can only be loaded in a browser.'));
  }

  if (window.Square?.payments) {
    return Promise.resolve(window.Square);
  }

  if (!squareScriptPromise) {
    squareScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.getElementById(SQUARE_SCRIPT_ID);
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.Square));
        existingScript.addEventListener('error', () => reject(new Error('Unable to load Square Web Payments SDK.')));
        return;
      }

      const script = document.createElement('script');
      script.id = SQUARE_SCRIPT_ID;
      script.src = getSquareScriptSrc();
      script.async = true;
      script.onload = () => {
        if (!window.Square?.payments) {
          reject(new Error('Square Web Payments SDK loaded but did not initialize correctly.'));
          return;
        }
        resolve(window.Square);
      };
      script.onerror = () => reject(new Error('Unable to load Square Web Payments SDK.'));
      document.head.appendChild(script);
    });
  }

  return squareScriptPromise;
}
