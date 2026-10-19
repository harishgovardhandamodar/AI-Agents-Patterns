# AI Agent Patterns & Guardrails — static dashboard image.
#
# No build step: the app is plain HTML/CSS/JS plus JSON data and markdown
# design docs, served by a tiny stdlib Python server (serve.py). The server is
# needed only because the Design & Architecture tab fetches design/*.md.

FROM python:3.12-slim

LABEL org.opencontainers.image.title="AI Agent Patterns & Guardrails" \
      org.opencontainers.image.description="Interactive dashboard of AI agent design patterns, failure scenarios, live control-flow traces, UML/architecture docs and a guardrail lab." \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Copy only what the server actually serves.
COPY serve.py    ./serve.py
COPY index.html  ./index.html
COPY sw.js       ./sw.js
COPY css         ./css
COPY js          ./js
COPY data        ./data
COPY design      ./design

# Run unprivileged.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin appuser
USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3).status == 200 else 1)"

CMD ["python3", "serve.py", "8080"]
