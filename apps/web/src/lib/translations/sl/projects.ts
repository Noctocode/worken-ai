import type { projects as projectsEn } from "../en/projects";

export const projects: Record<keyof typeof projectsEn, string> = {
  "projectCreate.title": "Ustvari projekt",
  "projectCreate.projectNamePlaceholder": "Ime projekta",
  "projectCreate.nameRequired": "Ime projekta je obvezno",
  "projectCreate.selectType": "Izberi vrsto projekta",
  "projectCreate.personalTooltip":
    "Zasebno delovno okolje samo za vas. Poraba se šteje k vašemu osebnemu mesečnemu proračunu.",
  "projectCreate.teamTooltip":
    "Skupno delovno okolje za ekipo. Poraba se šteje k mesečnemu proračunu izbrane ekipe.",
  "projectCreate.personalDesc":
    "Namenjen prostor za ustvarjanje in testiranje vaših AI klepetalnikov. Zasebno oblikujte pogovore in izpopolnjujte prompte.",
  "projectCreate.teamDesc":
    "Skupno delovno okolje za razvoj AI pogovornih izkušenj. Sodelujte pri oblikovanju klepetalnikov in upravljajte skupne prompte.",
  "projectCreate.noTeams": "Nimate lastnih ekip ali ekip, ki jih soupravljate.",
  "projectCreate.createTeamFirst": "Najprej ustvarite ekipo",
  "projectCreate.noTeamsSuffix": "za dodajanje ekipnega projekta.",
  "projectCreate.selectTeamPlaceholder": "Izberite ekipo...",
  "projectCreate.teamRequired": "Prosim izberite ekipo",
  "projectCreate.selectAgent": "Izberi agenta",
  "projectCreate.creating": "Ustvarjanje...",
  "projDetail.failedChangeModel": "Sprememba modela ni uspela",
  "projDetail.switchedTo1": "Preklopljeno na",
  "projDetail.switchedTo2": "— vaše naslednje sporočilo ga bo uporabilo.",
  "projDetail.couldntSaveFeedback":
    "Shranjevanje povratne informacije ni uspelo.",
  "projDetail.failedLoad": "Nalaganje projekta ni uspelo",
  "projDetail.goBack": "Nazaj",
  "projDetail.keyPausedPrefix": "Vaš",
  "projDetail.keyPausedSuffix": "ključ je začasno onemogočen.",
  "projDetail.routingViaDefault":
    "Klepet za ta projekt poteka prek privzetega WorkenAI namesto vašega lastnega ključa ponudnika. Ponovno omogočite ga na",
  "projDetail.integrationTab": "zavihku Integracija",
  "projDetail.toBill": "da ponovno zaračunamo na vaš račun.",
  "projDetail.thinking": "Razmišljam...",
  "projDetail.showThinking": "Prikaži razmišljanje",
  "projDetail.sources": "Viri",
  "projDetail.stopped": "Ustavljeno",
  "projDetail.noResponse":
    "Ni odgovora s AI prehoda. Endpoint za pretok morda ni na voljo — osvežite stran, in če težava traja, znova zaženite API strežnik.",
};
