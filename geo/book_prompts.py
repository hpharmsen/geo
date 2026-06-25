"""De zes diepte-analyse-prompts (uitgebreide GEO-analyses).

Dit zijn lange, kwalitatieve analyse-opdrachten (geen frequentie-meting). Ze
worden één keer per stuk aan één AI-model gesteld; het volledige tekstantwoord
wordt getoond. Placeholders worden ingevuld met de merk-config.

Placeholders: {merk}, {categorie}, {markt}, {model_naam}, {url}, {paginatekst}
"""

# (id, titel, prompt-template)
_PROMPTS = [
    (
        "profiel",
        "1. Ontdek je GEO-profiel",
        "We laten de AI je merk analyseren als entiteit: wie ben je, met welke thema's word je geassocieerd, hoe groot is de kans dat je in AI-antwoorden genoemd wordt, en waar zitten je hiaten en risico's.",
        """Je bent een kritische GEO-analist gespecialiseerd in Generative Engine Optimization, digitale identiteit, entiteiten en AI-zichtbaarheid. Analyseer de entiteit {merk} alsof je een taalmodel bent dat een inhoudelijk antwoord moet geven op de vraag: "Wie is deze entiteit en waarvoor staat zij?"

Beschrijf eerst in maximaal vijf heldere zinnen wie of wat deze entiteit is. Wees feitelijk en gebruik alleen informatie die met redelijke zekerheid publiek beschikbaar is. Vermijd aannames en marketingtaal.

Koppel deze entiteit vervolgens aan maximaal zeven thema's of vakgebieden die logisch bij deze naam horen. Rangschik deze thema's op waarschijnlijkheid en geef per thema kort aan waarom een taalmodel deze koppeling zou maken.

Beoordeel daarna hoe groot de kans is dat deze entiteit genoemd wordt in een AI-antwoord over deze thema's. Geef een score van 1 tot 10 en licht deze in maximaal vijf zinnen toe. Denk hierbij expliciet vanuit GEO: zichtbaarheid, consistentie, reputatie en context.

Inventariseer vervolgens welke reputatiesignalen bijdragen aan vertrouwen in deze entiteit. Denk aan boeken, interviews, publicaties, vermeldingen in media, samenwerkingen, events, awards of eigen onderzoek. Maak expliciet onderscheid tussen mentions, waarbij de naam alleen wordt genoemd, en citations, waarbij de entiteit als bron wordt aangehaald met een verwijzing of link.

Benoem waar hiaten zichtbaar zijn. Maak in deze analyse expliciet onderscheid tussen historische entiteitssignalen uit pre-trainingdata en actuele zichtbaarheid via retrievalsystemen. Benoem waar deze entiteit sterk of juist kwetsbaar is in beide lagen.

Analyseer daarna met welke andere personen, organisaties, merken of titels deze entiteit logisch verbonden is. Leg per verbinding kort uit hoe deze associatie het profiel versterkt of juist vertroebelt. Voer vervolgens een consistentiecheck uit en benoem waar verwarring kan ontstaan door naamvariaties, overlappende profielen, onduidelijke positionering of tegenstrijdige informatie.

Sluit af met een scherpe conclusie in vijf zinnen waarin je beoordeelt of deze entiteit binnen een GEO-context sterk genoeg gepositioneerd is om structureel genoemd te worden in AI-antwoorden. Wees kritisch, concreet en feitelijk. Vermijd complimenten en vermijd marketingtaal.""",
    ),
    (
        "benchmark",
        "2. GEO-benchmark",
        "We vragen de AI wie de gevestigde autoriteiten in jouw categorie zijn, waarom juist zij genoemd worden, welke namen ontbreken en waar voor jou de strategische kansen liggen.",
        """Je bent een neutrale GEO-analist. Beantwoord onderstaande vraag zo objectief mogelijk: "Wie worden in AI-antwoorden structureel genoemd als autoriteit binnen {categorie} in {markt}?" Selecteer maximaal zeven personen of bedrijven die inhoudelijk aantoonbaar passen binnen dit vakgebied.

Per geselecteerde naam geef je aan waarom deze entiteit waarschijnlijk vaak wordt genoemd in AI-antwoorden. Welke concrete reputatiesignalen dit ondersteunen, zoals boeken, onafhankelijke publicaties, interviews, vermeldingen op externe platforms, relevante events, samenwerkingen of eigen onderzoek. In welke primaire rol deze persoon of organisatie bekendstaat binnen het vakgebied. Of deze zichtbaarheid waarschijnlijk voortkomt uit langdurige reputatie in historische trainingsdata, actuele zichtbaarheid via publieke bronnen en retrievalsystemen, of een combinatie van beide.

Maak vervolgens een aanvullende analyse: Welke relevante namen ontbreken waarschijnlijk in AI-antwoorden, terwijl zij inhoudelijk wél passen binnen dit vakgebied? Wat missen zij aan reputatiesignalen of externe bevestiging? Waar liggen strategische kansen om zichtbaarder te worden in AI-antwoorden? Betrek hierin expliciet {merk}.

Sluit af met een korte conclusie, waarin je beschrijft hoe geconcentreerd het concurrentieveld is. Is het een gesloten club van vaste namen of is er ruimte voor nieuwe entiteiten om door te breken? Gebruik geen marketingtaal. Vermijd complimenten. Wees feitelijk, kritisch en concreet.""",
    ),
    (
        "merk",
        "3. GEO-merkanalyse",
        "We vragen de AI in gewone taal waarom jouw merk mogelijk níet wordt meegenomen bij vragen over je categorie, met drie concrete tips die je morgen kunt toepassen.",
        """Jij bent een ervaren en neutrale GEO-expert. Leg mij uit waarom {merk} mogelijk niet in het resultaat van {model_naam} wordt meegenomen bij vragen over {categorie}. Geef je antwoord in eenvoudige taal en geef drie concrete tips die ik morgen kan toepassen.""",
    ),
    (
        "sentiment",
        "4. GEO-sentimentanalyse",
        "We vragen wat de AI over je weet en met welke concurrenten je vergeleken wordt, met een sentimentscore per concurrent in een tabel.",
        """Stap 1. Wat weet je over het bedrijf {merk}?

Stap 2. Met wie worden ze vergeleken binnen {categorie}? Maak een sentimentscore en zet dit in een tabel.""",
    ),
    (
        "persona",
        "5. Persona-analyse",
        "We laten de AI een persona van jouw klant maken en de vragen die deze stelt tijdens de oriëntatie- en aankoopfase, met per vraag de motivatie en de belemmering.",
        """Jij bent een zeer ervaren copywriter die altijd denkt vanuit de ogen en het brein van de lezer. Maak eerst een korte persona voor {merk} ({categorie}). Beschrijf in een paar zinnen wie deze persoon is, in welke situatie hij zit en wanneer hij op zoek gaat naar een oplossing.

Identificeer daarna alle vragen die deze persoon stelt tijdens de oriëntatie- en aankoopfase. Formuleer deze vragen zoals iemand ze zou stellen aan Google, ChatGPT of een ander taalmodel. Noteer per vraag: de motivatie achter de vraag, de belangrijkste twijfel of belemmering.

Zet het resultaat in een tabel met drie kolommen:

Vraag | Motivatie | Belemmering.

Focus op concrete, realistische vragen die echte klanten stellen.""",
    ),
    (
        "dvv",
        "6. dvv-analyse (duidelijkheid, volledigheid, verleidelijkheid)",
        "We laten de AI je landingspagina beoordelen op duidelijkheid, volledigheid en verleidelijkheid, en de 10 belangrijkste klantvragen in kaart brengen met de check of de pagina ze beantwoordt.",
        """Beoordeel de tekst van de pagina {url} op drie punten: duidelijkheid, volledigheid en verleidelijkheid. Maak eerst een korte analyse voor wie deze tekst bedoeld is en wat het doel ervan is. Geef daarna je oordeel over de duidelijkheid, volledigheid en verleidelijkheid van de tekst op de pagina.

Met duidelijkheid bedoel ik dat de tekst eenvoudig te begrijpen is. Let daarbij op zinslengte, structuur, tussenkoppen en het gebruik van jargon. Met volledigheid bedoel ik of alle vragen die een klant heeft over {categorie} worden beantwoord. Met verleidelijkheid bedoel ik of de boodschap overtuigend is en aanzet tot actie.

Breng vervolgens de tien belangrijkste vragen in kaart die een klant heeft over {categorie}. Geef daarna per vraag aan of op deze pagina een duidelijk antwoord te vinden is.{paginatekst}""",
    ),
]


def build_book_prompts(config, model_naam="ChatGPT", paginatekst=None):
    """Geeft een lijst dicts terug: {id, titel, prompt} met ingevulde placeholders."""
    merk = config.get("merknaam", "")
    categorie = config.get("categorie", "")
    markt = config.get("markt", "Nederland")
    # De dvv-analyse beoordeelt een specifieke landingspagina; val terug op de hoofd-URL.
    url = (config.get("landingspagina") or config.get("url") or "").strip() or "de website van het merk"

    if paginatekst:
        pagina_blok = ("\n\n--- Hieronder de werkelijke tekst van de pagina "
                       + url + " ---\n\n" + paginatekst)
    else:
        pagina_blok = ("\n\n(Let op: de paginatekst kon niet automatisch worden "
                       "opgehaald. Baseer je oordeel op wat je over deze pagina/dit "
                       "merk weet en benoem dat als beperking.)")

    out = []
    for pid, titel, uitleg, template in _PROMPTS:
        prompt = template.format(
            merk=merk, categorie=categorie, markt=markt,
            model_naam=model_naam, url=url, paginatekst=pagina_blok,
        )
        out.append({"id": pid, "titel": titel, "uitleg": uitleg, "prompt": prompt})
    return out
