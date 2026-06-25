"""Bouwt rapport.md — een markdown-rapport dat de gebruiker als PROMPT kan
plakken om er een gebrand PDF van te laten maken. De webapp maakt zelf geen PDF.
"""

import os
import re


def _bold_merk(text, merk):
    if not merk:
        return text
    return re.sub("(?i)(" + re.escape(merk) + ")", r"**\1**", text)


def _pct(x):
    return "{:.0f}%".format(x * 100) if x is not None else "n.v.t."


def _provider_label(p):
    return {"openai": "ChatGPT (OpenAI)", "perplexity": "Perplexity",
            "gemini": "Gemini (Google)", "anthropic": "Claude (Anthropic)"}.get(p, p)


def _modus_blok(L, result, modus):
    """Rendert samenvatting + per-model-tabel + concurrenten voor één meetmodus."""
    merk = result["merknaam"]
    rows = [r for r in result.get("rows", []) if r.get("modus") == modus]
    totaal = result.get("totaal_per_modus", {}).get(modus, {})
    concurrenten = result.get("concurrenten_per_modus", {}).get(modus, {})
    toon_positie = bool(result.get("heeft_concurrenten"))

    L.append("- **Mention share (totaal):** " + _pct(totaal.get("mention_share")) +
             " — aandeel van de metingen waarin de AI het merk spontaan noemde.")
    L.append("- **Citatie share (totaal):** " + _pct(totaal.get("citatie_share")) +
             " — aandeel waarin de eigen website als bron werd genoemd.")
    if toon_positie and totaal.get("gem_positie") is not None:
        L.append("- **Gemiddelde positie:** " + str(totaal["gem_positie"]) +
                 " — gemiddelde plek in de volgorde t.o.v. je opgegeven concurrenten (1 = als eerste genoemd).")
    L.append("")

    if toon_positie:
        L.append("| AI-model | Runs | Mention share | Citatie share | Gemiddelde positie |")
        L.append("|---|---|---|---|---|")
        for agg in rows:
            L.append("| {label} | {runs} | {ms} | {cs} | {pos} |".format(
                label=_provider_label(agg["provider"]), runs=agg["runs"],
                ms=_pct(agg["mention_share"]), cs=_pct(agg["citatie_share"]),
                pos=agg["gem_positie"] if agg.get("gem_positie") is not None else "—",
            ))
    else:
        L.append("| AI-model | Runs | Mention share | Citatie share |")
        L.append("|---|---|---|---|")
        for agg in rows:
            L.append("| {label} | {runs} | {ms} | {cs} |".format(
                label=_provider_label(agg["provider"]), runs=agg["runs"],
                ms=_pct(agg["mention_share"]), cs=_pct(agg["citatie_share"]),
            ))
    L.append("")

    if concurrenten:
        L.append("**Positie t.o.v. concurrenten** (mention share per merk)")
        L.append("")
        rij = [(merk, totaal.get("mention_share") or 0)] + list(concurrenten.items())
        L.append("| Merk | Mention share |")
        L.append("|---|---|")
        for naam, share in sorted(rij, key=lambda kv: (kv[1] if kv[1] is not None else 0), reverse=True):
            ster = " *(jij)*" if naam == merk else ""
            L.append("| " + naam + ster + " | " + _pct(share) + " |")
        L.append("")


def _bewijs_blok(L, result, modus):
    """Inklapbaar 'bewijs'-blok: per vraag, per model de frequentie + één
    representatief antwoord (merk vetgedrukt)."""
    items = [a for a in result.get("antwoorden", []) if a.get("modus") == modus]
    if not items:
        return
    merk = result["merknaam"]
    order = {p: i for i, p in enumerate(result.get("promptset", []))}
    prompts = sorted({a["prompt"] for a in items}, key=lambda p: order.get(p, 999))

    L.append("<details><summary><b>Bekijk de antwoorden (bewijs)</b></summary>")
    L.append("")
    for prompt in prompts:
        L.append("**Vraag:** " + prompt)
        L.append("")
        for a in [x for x in items if x["prompt"] == prompt]:
            freq = ("genoemd in %d/%d runs" % (a["mentioned_count"], a["runs"])) if a["runs"] else "geen geslaagde runs"
            L.append("- *" + _provider_label(a["provider"]) + "* — " + freq)
            if a.get("voorbeeld_error"):
                L.append("  > *(call mislukt)*")
            else:
                tekst = _bold_merk((a.get("voorbeeld_text") or "").strip(), merk)
                for regel in (tekst.splitlines() or [""]):
                    L.append("  > " + regel)
            L.append("")
    L.append("</details>")
    L.append("")


_MODUS_UITLEG = {
    "kaal": "**Uit het geheugen** — de AI antwoordt zonder live te zoeken, puur uit z'n trainingsdata. Dit laat zien of je merk een herkende entiteit is.",
    "zoeken": "**Met live zoeken** — de AI zoekt tijdens het antwoord op het web. Dit lijkt het meest op wat een echte gebruiker ziet.",
}


def build_report(result):
    merk = result["merknaam"]
    datum = result["datum"]
    modi = result.get("modi", [])
    modus_labels = result.get("modus_labels", {})
    demo = result.get("demo_modus", False)

    L = []
    L.append(
        "> **Instructie:** Gebruik onderstaande meetresultaten om een professioneel, "
        "white-label GEO-rapport (PDF) te maken in de huisstijl van het bureau. "
        "Vul logo, kleuren en bureaunaam zelf in op de gemarkeerde plekken."
    )
    L.append("")
    L.append("# GEO-zichtbaarheidsrapport — " + merk)
    L.append("")
    L.append("*Meting uitgevoerd op " + datum + ".*  ")
    L.append("*Branding: [LOGO BUREAU] · [KLEUREN] · [BUREAUNAAM]*")
    L.append("")

    if demo:
        L.append("> ⚠️ **Let op:** deze meting draaide (deels) in **demo-modus** zonder echte API-keys. "
                 "De cijfers zijn illustratief, niet representatief.")
        L.append("")

    # Uitleg van de gemeten modus(sen)
    L.append("## Wat is gemeten")
    L.append("")
    for m in modi:
        L.append("- " + _MODUS_UITLEG.get(m, modus_labels.get(m, m)))
    if not result.get("heeft_concurrenten"):
        L.append("- *Er zijn geen concurrenten opgegeven, daarom tonen we geen positie-cijfer "
                 "(positie is alleen zinvol t.o.v. concurrenten).*")
    L.append("")

    # Eén blok per modus, met inklapbaar bewijs
    for m in modi:
        if len(modi) > 1:
            L.append("## " + modus_labels.get(m, m))
        else:
            L.append("## Resultaat")
        L.append("")
        _modus_blok(L, result, m)
        _bewijs_blok(L, result, m)

    # Diepte-analyses uit het boek
    boek = result.get("boek_analyses") or []
    if boek:
        L.append("## " + os.getenv("GEO_ANALYSE_TITEL", "Diepte-analyses"))
        L.append("")
        boek_bron = str(result.get("boek_model") or "de AI").split(" (")[0]
        L.append("De volgende uitgebreide GEO-analyses zijn uitgevoerd door " +
                 boek_bron + " voor " + merk + ".")
        L.append("")
        for a in boek:
            L.append("### " + a["titel"])
            L.append("")
            if a.get("uitleg"):
                L.append("*" + a["uitleg"] + "*")
                L.append("")
            if a.get("prompt"):
                L.append("<details><summary>Toon de exacte vraag aan de AI</summary>")
                L.append("")
                for regel in a["prompt"].strip().splitlines():
                    L.append("> " + regel)
                L.append("")
                L.append("</details>")
                L.append("")
            if a.get("error"):
                L.append("*Niet gelukt: " + str(a["error"]) + "*")
            else:
                L.append(a.get("antwoord", "").strip())
            L.append("")

    # Methodische noot
    L.append("## Methodische noot")
    L.append("")
    L.append("Deze meting gebruikt de **API** van de AI-modellen — het 'kale' model, "
             "schoon en reproduceerbaar, zonder geheugen of inloghistorie. Dat is niet "
             "identiek aan wat een ingelogde gebruiker in de web-app ziet. De waarde zit "
             "niet in één absolute meting, maar in **dezelfde meetopstelling herhaald over "
             "de tijd**: zo zie je of je GEO-werk effect heeft. Elke prompt is "
             + str(result.get("runs_per_prompt", "?")) + "× schoon opnieuw gesteld.")
    L.append("")

    return "\n".join(L)


def _aanbevelingen(totaal, concurrenten, merk):
    out = []
    ms = totaal["mention_share"] if totaal["mention_share"] is not None else 0.0
    cs = totaal["citatie_share"] if totaal["citatie_share"] is not None else 0.0

    if ms < 0.3:
        out.append("**Vergroot je entiteit-signaal.** Het merk wordt zelden spontaan genoemd. "
                   "Werk aan vermeldingen in vakmedia, een Wikidata-item en consistente NAW/sameAs-gegevens, "
                   "zodat AI-modellen het merk als relevante speler in de categorie herkennen.")
    elif ms < 0.6:
        out.append("**Verstevig je positie in de categorie.** Het merk komt al voor, maar niet consistent. "
                   "Publiceer categorie- en vergelijkingscontent ('beste X', 'X vs Y') zodat het merk vaker "
                   "in de shortlist belandt.")
    else:
        out.append("**Behoud en verdedig je sterke positie.** Het merk wordt vaak genoemd. "
                   "Houd content actueel en monitor of concurrenten terrein winnen.")

    if cs < 0.3:
        out.append("**Maak je content citeerbaar.** De eigen website wordt zelden als bron genoemd. "
                   "Voeg heldere, overneembare antwoorden toe (TL;DR, FAQ-blokken, bronvermelding) en "
                   "zorg dat AI-bots toegang hebben (robots.txt, llms.txt).")
    else:
        out.append("**Bouw je citatie-voorsprong uit.** Je wordt al als bron geciteerd; breid citeerbare "
                   "content uit naar meer categorie-vragen.")

    # Sterkste concurrent benoemen
    if concurrenten:
        sterkste = max(concurrenten.items(), key=lambda kv: kv[1])
        if sterkste[1] > ms:
            out.append("**Analyseer " + sterkste[0] + ".** Die scoort hoger op spontane vermelding (" +
                       _pct(sterkste[1]) + " vs " + _pct(ms) + "). Kijk welke content en bronnen die "
                       "concurrent sterk maken bij AI-modellen en sluit het gat.")
        else:
            out.append("**Houd je voorsprong vast.** Je scoort op spontane vermelding hoger dan je "
                       "opgegeven concurrenten — blijf publiceren om dat zo te houden.")
    else:
        out.append("**Voeg concurrenten toe aan de meting** om je relatieve positie te kunnen volgen.")

    return out
