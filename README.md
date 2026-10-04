<div align="center">

<img src="public/icons/512.png" alt="Logo Limeris votes" width="128" height="128">

# Limeris votes

**Ne rate plus jamais un vote pour ton serveur Minecraft.**

Extension Chrome / Brave qui suit les sites de vote de tes serveurs,
te prévient dès qu'un vote redevient disponible et t'emmène d'un site au suivant.

Développée par **[Sliver91](https://github.com/Sliver91)** · [limeris.fr](https://limeris.fr)

</div>

---

## Ce que fait l'extension

- **Rappels automatiques** — une notification dès qu'un site de vote redevient disponible, avec relance si tu n'as pas encore voté.
- **File de vote** — un clic sur « Voter », et les sites s'enchaînent tout seuls : l'extension ouvre le site, attend la confirmation du serveur, puis passe au suivant.
- **Comptes à rebours** — le temps restant avant le prochain vote, site par site, et le nombre de votes disponibles affiché sur l'icône.
- **Plusieurs serveurs** — ajoute autant de serveurs que tu veux, chacun avec son pseudo.
- **Statistiques** — votes par jour, heures où tu votes le plus, taux de réussite par site.
- **À ton rythme** — plage « ne pas déranger », choix du son et du volume, ouverture dans un onglet ou une petite fenêtre.

L'extension fonctionne avec les sites de serveur faits avec **Azuriom**.
Elle ne vote pas à ta place : tu valides le captcha sur chaque site, et le site du serveur confirme le vote et donne la récompense.

## Installation

L'extension s'installe pour l'instant en mode développeur, sur ordinateur.

1. Crée un nouveau dossier à la racine de ton disque dur, par exemple `C:\Limeris votes`. Ce dossier restera en place : c'est lui que le navigateur relit à chaque démarrage, et c'est dedans que se feront toutes les mises à jour.
2. Télécharge le fichier zip de la dernière version dans l'onglet **[Releases](https://github.com/Sliver91/limeris-votes-extension/releases/latest)**.
3. Décompresse le zip dans ce dossier. Tu dois y trouver le dossier `extension`, `Mettre à jour.bat`, `mise-a-jour.ps1` et `LISEZ-MOI.txt`.
4. Ouvre `chrome://extensions` (ou `brave://extensions`).
5. Active le **Mode développeur**, en haut à droite.
6. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `extension` (par exemple `C:\Limeris votes\extension`).
7. Épingle l'extension : icône en forme de pièce de puzzle dans la barre du navigateur, puis l'épingle à côté de « Limeris votes ».
8. Clique sur l'icône Limeris, puis **Ajouter un serveur** : l'adresse du site du serveur et ton pseudo. Le navigateur demande d'autoriser l'accès à ce site : accepte.

> **Important** — ne déplace pas, ne renomme pas et ne supprime pas ce dossier après l'installation, et ne l'installe pas depuis le dossier Téléchargements ou le Bureau : si le dossier bouge, l'extension disparaît du navigateur.

## Mise à jour

À chaque nouvelle version, c'est toujours le même dossier qui est mis à jour : pas besoin de réinstaller l'extension.

1. Double-clique sur `Mettre à jour.bat`, dans ton dossier (par exemple `C:\Limeris votes`) : il télécharge la dernière version et remplace le contenu du dossier `extension`.
2. Ouvre `chrome://extensions` (ou `brave://extensions`) et clique sur la flèche de rechargement de « Limeris votes ».

Tu peux aussi le faire à la main : télécharge le nouveau zip dans les **Releases** et décompresse-le dans le même dossier en remplaçant les fichiers, puis recharge l'extension.

Tes serveurs, tes paramètres et ton historique sont conservés.

**Plus tard**, l'extension sera publiée sur le Chrome Web Store : l'installation se fera en un clic et les mises à jour seront automatiques, sans dossier ni mode développeur.

## Vie privée

- Aucun compte, aucun serveur intermédiaire : tes serveurs, tes paramètres et ton historique restent dans ton navigateur.
- L'extension ne demande l'accès qu'aux sites des serveurs que tu ajoutes, un par un. Elle ne lit ni ton historique ni le contenu des autres pages.

## Licence

**Copyright © 2026 Sliver91 — Limeris. Tous droits réservés.**

Ce projet n'est pas open source. Il est interdit de le copier, de le modifier, de le redistribuer ou de le réutiliser, en tout ou en partie, sans l'accord écrit de l'auteur. Voir le fichier [LICENSE](LICENSE).
