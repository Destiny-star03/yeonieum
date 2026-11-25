import os
import re
from pathlib import Path
from time import sleep
from urllib.parse import urlencode
from urllib.request import urlopen


def update_forever():
    hostname = os.environ.get("YEONIEUM_PUBLIC_HOST", "").strip().lower()
    domain = re.fullmatch(
        r"([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.duckdns\.org", hostname
    )
    if not domain:
        raise SystemExit("YEONIEUM_PUBLIC_HOST must be a Duck DNS hostname.")

    token = Path("/run/secrets/duckdns_token").read_text(encoding="utf-8-sig").strip()
    if not token:
        raise SystemExit("The Duck DNS token file is empty.")

    query = urlencode({"domains": domain[1], "token": token, "ip": ""})
    url = f"https://www.duckdns.org/update?{query}"
    while True:
        try:
            with urlopen(url, timeout=15) as response:
                success = response.read(32).strip() == b"OK"
            print(
                "Duck DNS address refreshed."
                if success
                else "Duck DNS rejected the update."
            )
        except OSError:
            print("Duck DNS could not be reached. Retrying at the next interval.")
        sleep(300)


if __name__ == "__main__":
    update_forever()
