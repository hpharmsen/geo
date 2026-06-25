"""Genereert de vaste promptset voor een merk-meting.

De prompts zijn categorie-gericht: ze noemen de merknaam NIET. We willen
weten of een AI-model het merk spontaan noemt bij vragen waar het zou kunnen
opduiken. Zelfde input -> zelfde promptset, zodat metingen over de tijd
vergelijkbaar blijven.

Doelgroep: enkele vragen kunnen op een doelgroep worden afgestemd ({voor}).
Is er geen doelgroep opgegeven, dan wordt die toevoeging weggelaten en blijven
de vragen neutraal (geen aanname als "klein bedrijf").
"""

# Templates per taal. Placeholders: {categorie}, {markt}, {concurrent_1}, {voor}.
_TEMPLATES = {
    "nl": [
        "Wat is de beste {categorie} in {markt}?",
        "Welke {categorie} raad je aan{voor}?",
        "Wat zijn de top 5 aanbieders van {categorie}?",
        "Wat is een goed alternatief voor {concurrent_1}?",
        "Vergelijk de belangrijkste aanbieders van {categorie}.",
        "Waar moet ik op letten bij het kiezen van {categorie}?",
        "Welke {categorie} heeft de beste klantenservice?",
        "Wat is een betaalbare {categorie}{voor}?",
        "Welke {categorie} is het populairst in {markt}?",
        "Welke {categorie} kun je het beste kiezen{voor}?",
        "Wat zijn betrouwbare {categorie}-aanbieders?",
        "Welke {categorie} biedt de beste prijs-kwaliteitverhouding?",
    ],
    "en": [
        "What is the best {categorie} in {markt}?",
        "Which {categorie} would you recommend{voor}?",
        "What are the top 5 providers of {categorie}?",
        "What is a good alternative to {concurrent_1}?",
        "Compare the main providers of {categorie}.",
        "What should I look for when choosing {categorie}?",
        "Which {categorie} has the best customer service?",
        "What is an affordable {categorie}{voor}?",
        "Which {categorie} is most popular in {markt}?",
        "Which {categorie} would you choose{voor}?",
        "What are reliable {categorie} providers?",
        "Which {categorie} offers the best value for money?",
    ],
}


def generate_promptset(categorie, markt, concurrenten, taal="nl", doelgroep=""):
    """Bouwt de promptset. Geeft een lijst strings terug.

    De volgorde is deterministisch zodat dezelfde config altijd dezelfde
    promptset oplevert. Met `doelgroep` worden de doelgroep-vragen afgestemd;
    zonder doelgroep blijven ze neutraal.
    """
    taal = (taal or "nl").lower()
    templates = _TEMPLATES.get(taal, _TEMPLATES["nl"])
    concurrent_1 = concurrenten[0] if concurrenten else categorie

    doelgroep = (doelgroep or "").strip()
    if doelgroep:
        voor = (" voor " if taal == "nl" else " for ") + doelgroep
    else:
        voor = ""

    prompts = []
    for t in templates:
        prompt = t.format(
            categorie=categorie,
            markt=markt or ("Nederland" if taal == "nl" else "the market"),
            concurrent_1=concurrent_1,
            voor=voor,
        )
        prompts.append(prompt)
    return prompts
