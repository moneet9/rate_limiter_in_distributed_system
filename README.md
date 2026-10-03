# Distributed Rate Limiting System

A final-year CSE demonstration project showing shared Redis-backed rate-limit decisions across multiple application instances. The UI is plain HTML, CSS, and JavaScript; the backend is Node.js, Express, Redis, and Socket.IO.

## Quick start on Windows

Prerequisite: install Docker Desktop and make sure it is running.

1. Open PowerShell in this project folder.
2. Start everything:

	```powershell
	.\start.ps1
	```

	If PowerShell blocks local scripts, use the included `start.bat` file instead.
3. Open http://localhost:3001.
4. Stop everything when finished:

	```powershell
	.\stop.ps1
	```

	The Redis data volume is preserved. To also delete its data, run `docker compose down -v`.

The start script builds and launches Redis plus three application instances. The dashboard is available through `app-1` at port 3001; all three containers use the same Redis-backed quota state.

## How to use the app

1. **Dashboard**: watch total, allowed, rejected, throughput, latency, live traffic, and instance health.
2. **Rate policy**: choose a quota algorithm (Fixed Window, Sliding Window Counter, or Token Bucket) and an overload action. **Reject immediately** stops excess requests with HTTP 429; **Delay, then retry once** applies backpressure, waits up to the configured maximum delay, and records whether the retry was eventually allowed or rejected. For the standard demo, use 100 requests per 60 seconds, API key scope, and Reject.
3. **Traffic simulator**: enter 150 total requests, 25 requests/sec, one virtual client, and Constant traffic. Click **Start simulation**. Use Pause, Resume, or Stop while it runs.
4. **Request builder**: change the API key, identity type, endpoint, or headers and send one request or a batch of ten. The result shows the target instance, HTTP status, remaining quota, retry-after value, and the measured processing latency.
5. **Instances**: use **Simulate fault** on an instance, send more traffic, and observe that healthy instances continue processing. Use **Restart** to bring it back.
6. **Live monitor**: inspect each request decision and filter by Allowed or Rejected.
7. **Reports**: review measured throughput, acceptance rate, rejection rate, P95 latency, and per-instance distribution. Use **Export CSV** to download the current request report.

For a quick professor demonstration, run the 150-request simulation, change the API key and send another batch, switch to Token Bucket for a burst comparison, switch the overload action to Delay, and export the report to compare rejection and latency.

## Professor demonstration

1. Open **Rate policy** and keep the default Fixed Window policy at 100 requests per minute.
2. Open **Traffic simulator**, use 150 requests, 25 requests/sec, one virtual client, and start the run. The live counters should settle near 100 allowed and 50 rejected.
3. Change the API key in **Request builder** and send a batch. The new key receives an independent quota.
4. Change the active algorithm to Token Bucket, set capacity to 10 and refill to 2/sec, then send a burst and compare the report.
5. Stop an instance from **Instances** and continue traffic. The remaining healthy instances continue receiving requests while the shared quota remains consistent.
6. Export the current measurements from **Reports** as CSV.

## Choosing an overload behavior

The quota algorithm answers **when** a request is over the limit. The overload action answers **what the service does next**:

| Action | Behavior | Use when |
| --- | --- | --- |
| Reject immediately | Returns HTTP 429 without waiting. | Protecting expensive endpoints or failing fast under load |
| Delay, then retry once | Waits for the calculated retry interval up to the maximum delay, then makes one new atomic Redis decision. | Applying backpressure when a slower response is preferable to an immediate rejection |

Delayed requests are intentionally visible in the monitor as `DELAYED + ALLOWED` or `DELAYED + REJECTED`. This makes the trade-off measurable: rejection protects latency, while delay may improve acceptance at the cost of response time.

## API and tests

The main API is documented in the route names in `server.js`: policies, traffic, single/batch requests, instances, live metrics, request monitor, and experiment reports. Run `npm test` for algorithm correctness and shared-quota tests. Measurements shown as live are collected from actual processed requests; the UI labels illustrative demo hints separately.
