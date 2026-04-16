import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { loadSquareWebPaymentsSdk } from '../lib/squareWebPayments';

const SquareCardField = forwardRef(function SquareCardField({ onReadyStateChange }, ref) {
  const [initError, setInitError] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const cardContainerId = useMemo(() => `square-card-container-${Math.random().toString(36).slice(2)}`, []);
  const cardRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    const initializeCard = async () => {
      const applicationId = import.meta.env.VITE_SQUARE_APPLICATION_ID;
      const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID;

      if (!applicationId || !locationId) {
        if (mounted) {
          setInitError('Card entry is unavailable because Square is not configured for this environment.');
          setIsLoading(false);
          setIsReady(false);
          onReadyStateChange?.(false);
        }
        return;
      }

      try {
        const Square = await loadSquareWebPaymentsSdk();
        if (!mounted) return;

        const payments = Square.payments(applicationId, locationId);
        const card = await payments.card();
        if (!mounted) {
          await card.destroy();
          return;
        }

        await card.attach(`#${cardContainerId}`);
        cardRef.current = card;
        setIsReady(true);
        setInitError('');
        onReadyStateChange?.(true);
      } catch (error) {
        if (!mounted) return;
        setInitError(error.message || 'Unable to initialize secure card entry.');
        setIsReady(false);
        onReadyStateChange?.(false);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initializeCard();

    return () => {
      mounted = false;
      const card = cardRef.current;
      cardRef.current = null;
      if (card?.destroy) {
        card.destroy().catch(() => {});
      }
    };
  }, [cardContainerId, onReadyStateChange]);

  useImperativeHandle(ref, () => ({
    async tokenize() {
      if (!cardRef.current) {
        throw new Error(initError || 'Card entry is not ready yet.');
      }

      const result = await cardRef.current.tokenize();
      if (result.status !== 'OK') {
        const details = Array.isArray(result.errors) && result.errors.length
          ? result.errors.map((err) => err.message).join(' ')
          : 'Please confirm your card details and try again.';
        throw new Error(details);
      }

      const token = result.token || result.nonce;
      if (!token) {
        throw new Error('Square did not return a card token. Please try again.');
      }
      return token;
    },
    isReady: () => isReady,
  }), [initError, isReady]);

  return (
    <div className="square-card-field">
      <div id={cardContainerId} className="square-card-container" aria-live="polite" />
      {isLoading && <p className="muted">Loading secure card entry…</p>}
      {initError && <p className="form-error" role="alert">{initError}</p>}
    </div>
  );
});

export default SquareCardField;
