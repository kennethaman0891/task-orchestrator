# Colab Hub — visitor records and remote sign-in

This is the short guide for the person who owns the computer. You do not need to edit files or use the terminal.

Open **Colab** in the sidebar. That screen is **Colab Hub & Remote Access**.

## Invite someone

1. Choose **Invite Collaborator**.
2. Enter their email and a PIN (6 or more characters). Pick **Worker** if they should run commands, or **Viewer** if they should only look.
3. Send them the link and the PIN. Mail uses the **Mail / SMTP Settings** on this screen when you turn that on.

They open the link in a browser, enter the email and PIN, and land in your orchestrator. Nobody else can get in.

## Let people reach this computer

**LAN & Remote Access** is for people on the same home or office network. Turn it on and the screen shows the real address, such as `http://192.168.1.20:8765`, with a Copy button. Restart the app once after turning this on so it listens on the network.

**Public link** is optional. Turn it on when someone is outside your network. Task Orchestrator starts a free HTTPS address (a Cloudflare quick tunnel). No Cloudflare account is required. Copy the address and send it only to people you invited. Turn it off when you are done. It also turns off when you restart the app, and the address will be different next time.

If the public-link switch says cloudflared is not installed, people on your network can still use the LAN address. Installing `cloudflared` is what adds the public address.

## What you can see

**Live Presence** shows who is signed in right now and what they are doing (for example running a command or opening a workspace).

**Visitor Records** keeps one record for every sign-in:

- who it was (name, email, username) and whether they used an invite
- the network address, browser, system, and device
- when they signed in, when they were last seen, when they left, and how the visit ended (they signed out, the tab was closed, they went idle, or you ended it)
- how long they stayed
- a timeline of workspaces, terminals, commands, orchestrator / Qwen / agent tasks, messages, changes, and anything that was denied or failed
- failed sign-ins too, including an unknown email or a wrong PIN, with the network address

Search and filter by person, date, and status. Open a visit to read the timeline. **Verified** means the record still matches its activity and has not been edited. **CSV**, **Report**, and **PDF** download the visit you are looking at, or every visit that matches the filter. The report opens in a browser tab so you can print it.

Records are kept for the number of days shown at the bottom of Visitor Records (90 by default). `0` keeps them. Finished visits older than that are removed. A visit that is still open is never removed.

The desktop text files (`~/Desktop/TTO-Collab-*.txt`) keep working. Each line includes the visit id when the person was signed in.

## What you can do

- **End session** signs that person out immediately.
- **Block this person** uses the same revoke action as the collaborator list. Their sign-in stops working.
- **Email me when someone signs in** sends you a short note, using the Mail / SMTP settings. Leave it off if you do not want mail.
- **Sign-in lasts** is how long a sign-in stays valid (8 hours, 1 day, or 7 days). A new sign-in uses the value you pick. Idle sign-out still ends a quiet visit sooner.
- **Idle sign-out** ends a visit that has had no real activity for that many minutes. Closing the browser tab ends the visit within about a minute, because the page stops checking in.

## Safety

Owner controls (records, export, ending a session, blocking someone, LAN, the public link, mail) only work from your app on this computer. A collaborator cannot open them.

The public link and the LAN address both require an invited account. Repeated wrong PINs are slowed down. Over HTTPS the sign-in is also stored in a cookie the page script cannot read.
