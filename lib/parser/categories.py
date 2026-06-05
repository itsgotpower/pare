"""Merchant -> category keyword taxonomy (generic starter).

First match wins, so order matters (specific/structural buckets first).
Keywords are matched case-insensitively as substrings of the raw merchant
description.

This shipped list is intentionally GENERIC (universal merchants/patterns only) so
tracked source reveals nothing personal. The app's real, tuned taxonomy lives in
the gitignored data/seed-rules.json and is applied via the DB rules
(recategorizeAll runs after each upload), so personal categorization happens
locally without personal keywords ever entering source control.
"""

CATEGORY_RULES = [
    ("Cash advance / fees", ["CASH ADVANCE", "CASH ADV/BT", "CONV CHQ FEE", "BALANCE TRANSFER", "NSF", "OVERDRAFT", "INTEREST CHARGE"]),
    ("Groceries", ["SAFEWAY", "WHOLE FOODS", "REAL CDN", "SUPERSTORE", "COSTCO", "LOBLAW", "SOBEYS", "METRO ", "NO FRILLS", "SAVE-ON-FOODS", "IGA "]),
    ("Coffee", ["STARBUCKS", "TIM HORTON", "SECOND CUP", "BLENZ", "ESPRESSO", "COFFEE", "CAFE", "BAKEHOUSE"]),
    ("Restaurants & takeout", [
        "MCDONALD", "SUBWAY", "PIZZA", "CHIPOTLE", "UBER EATS", "DOORDASH", "SKIPTHEDISHES",
        "A&W", "WENDY", "BURGER", "RAMEN", "SUSHI", "PHO ", "TACO", "DONAIR", "SHAWARMA",
        "RESTAURANT", "DINER", "TST-", "TST*",
    ]),
    ("Subscriptions", [
        "NETFLIX", "SPOTIFY", "YOUTUBEPREMIUM", "GOOGLE ONE", "GOOGLE*GOOGLE", "AMAZONPRIME",
        "AMAZON.CA PRIME", "PRIME MEMBER", "APPLE.COM/BILL", "DISNEY", "AUDIBLE", "CLASSPASS",
        "STRAVA", "DASHPASS",
    ]),
    ("Phone / utilities", ["ROGERS", "TELUS", "FIDO", "SHAW", "HYDRO", "FORTIS", "ENBRIDGE"]),
    ("Gym / fitness / recovery", ["GYM", "FITNESS", "YOGA", "YMCA", "GOODLIFE", "CLIMBING", "PILATES", "CROSSFIT"]),
    ("Running / cycling gear", ["SPORT CHEK", "ARCTERYX", "ADIDAS", "NIKE", "NEW BALANCE", "RUNNING ROOM", "DECATHLON"]),
    ("Transport / gas / parking", [
        "ESSO", "SHELL", "CHEVRON", "PETRO", "UBER TRIP", "LYFT", "PAYBYPHONE", "IMPARK",
        "EASYPARK", "PARKING", "COMPASS", "TRANSIT", "7-ELEVEN",
    ]),
    ("Travel (air/hotel)", [
        "AIR CANADA", "AIRCANADA", "WESTJET", "DELTA AIR", "UNITED AIRLINES", "AIRLINES",
        "AIRBNB", "EXPEDIA", "HOTEL", "MARRIOTT", "AIRPORT",
    ]),
    ("Health / pharmacy", ["SHOPPERS DRUG", "PHARMACY", "DENTAL", "CVS", "REXALL", "CLINIC", "MEDICAL", "OPTICAL"]),
    ("Shopping / retail", [
        "AMAZON.CA*", "AMZN MKTP", "WAL-MART", "WALMART", "WINNERS", "TARGET", "INDIGO",
        "APPLE STORE", "BEST BUY", "HOMESENSE", "TEMU", "LULULEMON",
    ]),
    ("Gambling", ["CASINO", "LOTTERY", "POKER"]),
]

def categorize(description: str) -> str:
    d = description.upper()
    for name, kws in CATEGORY_RULES:
        if any(kw in d for kw in kws):
            return name
    return "Other / uncategorized"
