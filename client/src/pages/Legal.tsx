// Privacy Policy and Terms. Starter text for the pilot, written for India (DPDP Act 2023).
// This is a template, not legal advice: have a lawyer review it before a public launch.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { appConfig } from "../lib/push";

const UPDATED = "28 September 2026";

function useSupportEmail() {
  const [email, setEmail] = useState("support@yofellow.app");
  useEffect(() => {
    appConfig()
      .then((c) => c.supportEmail && setEmail(c.supportEmail))
      .catch(() => {});
  }, []);
  return email;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="page legal">
      <button className="btn ghost small" onClick={() => (history.length > 1 ? nav(-1) : nav("/"))}>
        ← Back
      </button>
      <h2>{title}</h2>
      <p className="muted">Last updated {UPDATED}</p>
      {children}
      <p className="muted">
        See also <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
      </p>
    </div>
  );
}

export function Privacy() {
  const email = useSupportEmail();
  return (
    <Shell title="Privacy Policy">
      <p>YoFellow helps people on the same train, flight, bus or metro meet and chat. This page explains what we collect, why, and what you can do about it.</p>

      <h3>What we collect</h3>
      <ul>
        <li><b>Account:</b> your email address (from Google, or the one you sign up with) to log you in, and your first name, age, gender, city, bio and interests. If you sign in with Google we only get your name and email, never your Google password or other Google data.</li>
        <li><b>Journeys:</b> the trips you add (mode, number, date, optional coach, from and to).</li>
        <li><b>Messages:</b> private chats, group room messages, game moves and cab share posts.</li>
        <li><b>Signal map:</b> if you allow location, where your network dropped along a route, so we can warn others about dead zones.</li>
        <li><b>Usage:</b> simple events like "added a trip" or "sent a message" so we know what works. No ad trackers.</li>
        <li><b>Notifications:</b> if you turn them on, a browser push address (not your contacts or other apps).</li>
      </ul>

      <h3>What others see</h3>
      <p>Co-travellers see your first name, age, gender, city, bio and interests. Your email address is never shown. Your coach or seat is only revealed if both of you tap "meet". Women only mode hides you from men entirely.</p>

      <h3>Offline and nearby phones</h3>
      <p>When there is no network, messages in public train rooms can hop between nearby YoFellow phones. They are signed so they can't be faked. Private chats, coach rooms and women rooms never travel this way.</p>

      <h3>Why we use it</h3>
      <p>Only to run YoFellow: matching you with co-travellers, delivering messages, keeping people safe (reports, blocks, moderation) and improving the app. We do not sell your data or show ads.</p>

      <h3>Who we share it with</h3>
      <p>Service providers that run the app for us: hosting (Render), database (Neon), sign in (Google Firebase) and your browser's push service. We may share data if the law requires it, or to protect someone's safety.</p>

      <h3>How long we keep it</h3>
      <p>As long as your account exists. Group rooms are archived after the journey. When you delete your account, your profile, trips, chats and messages are deleted from our database.</p>

      <h3>Your rights</h3>
      <ul>
        <li><b>See your data:</b> Me → Download my data.</li>
        <li><b>Correct it:</b> edit your profile any time.</li>
        <li><b>Delete it:</b> Me → Delete account.</li>
        <li><b>Complain:</b> write to our grievance contact below. We reply within 7 days.</li>
      </ul>

      <h3>Age</h3>
      <p>YoFellow is only for people 18 and older. We delete accounts we learn belong to someone younger.</p>

      <h3>Contact and grievances</h3>
      <p>
        Email <a href={`mailto:${email}`}>{email}</a>. If you're not happy with our answer you can approach the Data Protection Board of India.
      </p>
    </Shell>
  );
}

export function Terms() {
  const email = useSupportEmail();
  return (
    <Shell title="Terms of Use">
      <p>By using YoFellow you agree to these terms. If you don't agree, please don't use the app.</p>

      <h3>Who can use it</h3>
      <p>You must be 18 or older and give true details about yourself. One account per person, with an email address you have verified.</p>

      <h3>Be a good fellow</h3>
      <ul>
        <li>No harassment, threats, hate, or sexual messages to people who didn't ask for them.</li>
        <li>No spam, scams, selling, or asking for money.</li>
        <li>Don't pretend to be someone else, and don't share other people's private details.</li>
        <li>No is no. If someone doesn't reply or blocks you, move on.</li>
        <li>Nothing illegal.</li>
      </ul>
      <p>We can hide content, and suspend or delete accounts that break these rules, with or without warning.</p>

      <h3>Meeting people and sharing cabs</h3>
      <p>YoFellow introduces travellers. We don't verify identities beyond your email address and we are not responsible for how people behave. Meet in public places, tell someone where you are, and trust your gut. Cab bookings happen in the cab company's app, and fares are agreed between riders. In an emergency call 112.</p>

      <h3>Your content</h3>
      <p>You own what you post. You give us permission to store and show it to the people it's meant for, so the app can work. Report anything harmful from the chat or room menu.</p>

      <h3>The app</h3>
      <p>YoFellow is a pilot. It is provided "as is" and may change, have bugs, or be unavailable, especially offline. To the extent the law allows, we are not liable for indirect losses from using it.</p>

      <h3>Changes</h3>
      <p>If we change these terms in a big way, we'll ask you to accept them again in the app.</p>

      <h3>Contact</h3>
      <p>
        <a href={`mailto:${email}`}>{email}</a>. These terms are governed by the laws of India.
      </p>
    </Shell>
  );
}
