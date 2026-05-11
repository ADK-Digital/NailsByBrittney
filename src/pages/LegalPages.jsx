import { Link } from 'react-router-dom';
import { EMAIL, PHONE_DISPLAY, PHONE_LINK } from '../lib/constants';

const LEGAL_EMAIL = 'nailsbybrittneyp@gmail.com';
const EFFECTIVE_DATE = 'May 11, 2026';

function LegalHeader() {
  return (
    <header className="sticky-nav">
      <div className="container nav-inner legal-nav-inner">
        <Link to="/" className="brand-mini">Nails by Brittney</Link>
        <nav className="nav-links legal-nav-links" aria-label="Legal page navigation">
          <Link to="/">Home</Link>
          <Link to="/#booking">Book</Link>
          <Link to="/privacy-policy">Privacy Policy</Link>
          <Link to="/terms">Terms</Link>
        </nav>
      </div>
    </header>
  );
}

function LegalFooter() {
  return (
    <footer className="footer legal-footer" role="contentinfo">
      <div className="container">
        <p>Nails by Brittney</p>
        <p><a href={`tel:${PHONE_LINK}`}>{PHONE_DISPLAY}</a> • <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a></p>
        <p className="legal-secondary-contact">General email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
        <p><Link to="/privacy-policy">Privacy Policy</Link> • <Link to="/terms">Terms &amp; Conditions</Link></p>
      </div>
    </footer>
  );
}

function LegalLayout({ eyebrow, title, children }) {
  return (
    <>
      <LegalHeader />
      <main className="legal-page">
        <section className="section legal-hero">
          <div className="container legal-container">
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="legal-effective-date">Effective date: {EFFECTIVE_DATE}</p>
          </div>
        </section>
        <section className="section legal-content-section">
          <div className="container legal-container legal-card">
            {children}
          </div>
        </section>
      </main>
      <LegalFooter />
    </>
  );
}

export function PrivacyPolicyPage() {
  return (
    <LegalLayout eyebrow="Privacy" title="Privacy Policy">
      <p>
        Nails by Brittney respects your privacy. This Privacy Policy explains what information is collected when you use the booking website, how it is used for appointment-related services, and how you can contact us with questions.
      </p>

      <h2>Information we collect</h2>
      <p>When you request an appointment or communicate with Nails by Brittney, we may collect:</p>
      <ul>
        <li>Name and contact information, including phone number and email address.</li>
        <li>Appointment details, including requested services, dates, times, notes, preferences, and booking status.</li>
        <li>Payment or card-on-file information needed to support booking policies, handled securely through Square.</li>
        <li>Messages related to booking confirmations, reminders, cancellations, appointment updates, and customer support.</li>
      </ul>

      <h2>Payment information and Square</h2>
      <p>
        Payment card information is processed securely through Square. Card details are tokenized by Square and are not stored directly by Nails by Brittney. Nails by Brittney may use the Square card-on-file tools to apply approved service charges, late cancellation fees, or no-show fees under the booking policy.
      </p>

      <h2>How we use your information</h2>
      <p>Your information is used to operate the booking process and provide appointment-related customer support. This may include:</p>
      <ul>
        <li>Reviewing, approving, declining, or updating appointment requests.</li>
        <li>Sending booking confirmations, reminders, cancellations, appointment updates, and customer support communications.</li>
        <li>Maintaining appointment records and enforcing booking, cancellation, card-on-file, and no-show policies.</li>
        <li>Responding to your questions or requests.</li>
      </ul>

      <h2>SMS and email providers</h2>
      <p>
        Nails by Brittney may use Twilio to send transactional SMS messages related to appointments. Resend and other email providers may be used for transactional email communications. These communications are strictly appointment-related and are not used for promotional or marketing SMS campaigns.
      </p>

      <h2>Sharing of information</h2>
      <p>
        Customer information is not sold to third parties. Information may be shared with trusted service providers only as needed to operate booking, payment processing, SMS, email, hosting, security, or customer support services.
      </p>

      <h2>Your choices and opt-out instructions</h2>
      <p>
        You may choose SMS, email, or both when requesting an appointment. To unsubscribe from SMS messages, reply STOP to any SMS message from Nails by Brittney. For assistance, contact Nails by Brittney using the details below.
      </p>

      <h2>Contact</h2>
      <p>
        Nails by Brittney<br />
        Email: <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a><br />
        Phone: <a href={`tel:${PHONE_LINK}`}>{PHONE_DISPLAY}</a>
      </p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout eyebrow="Terms" title="Terms & Conditions">
      <p>
        These Terms &amp; Conditions apply to appointment requests and services booked through the Nails by Brittney website. By submitting a booking request, you agree to these appointment-related terms.
      </p>

      <h2>Appointment requests</h2>
      <p>
        Submitting the booking form creates an appointment request. Appointment requests are subject to review and approval by Nails by Brittney. Your appointment is not confirmed until Nails by Brittney approves the request and sends a confirmation.
      </p>

      <h2>Booking and cancellation policy</h2>
      <p>
        A valid credit or debit card is required to request an appointment. If you need to cancel or reschedule, please contact Nails by Brittney as early as possible. Late cancellations and no-shows make it difficult to offer the time to another client, so fees may apply as described below.
      </p>
      <ul>
        <li>Late cancellation: If you cancel less than 24 hours before your scheduled appointment, you may be charged 25% of the estimated service total.</li>
        <li>No-show: If you miss your appointment without notice, you may be charged 50% of the estimated service total.</li>
      </ul>

      <h2>Card-on-file authorization</h2>
      <p>
        By submitting an appointment request with card information, you authorize Nails by Brittney to securely keep a card on file through Square. Your card will not be charged at the time of booking unless a charge is otherwise disclosed. You authorize Nails by Brittney to manually charge the card on file for approved service charges, late cancellation fees, or no-show fees under these Terms.
      </p>

      <h2>SMS consent</h2>
      <p>
        By submitting the booking form and selecting SMS communications, you agree to receive transactional text messages from Nails by Brittney related to your appointments, including confirmations, reminders, cancellations, updates, and customer support. Message and data rates may apply. Message frequency varies. Reply STOP to opt out of SMS messages. Reply HELP for assistance.
      </p>

      <h2>Service disclaimer and limitation of liability</h2>
      <p>
        Nails by Brittney provides nail services with professional care, but results and wear time can vary based on nail condition, lifestyle, aftercare, and other individual factors. To the fullest extent permitted by law, Nails by Brittney is not responsible for indirect, incidental, or consequential damages arising from use of the booking website or services.
      </p>

      <h2>Contact</h2>
      <p>
        Nails by Brittney<br />
        Email: <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a><br />
        Phone: <a href={`tel:${PHONE_LINK}`}>{PHONE_DISPLAY}</a>
      </p>
    </LegalLayout>
  );
}
