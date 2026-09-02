"""Utilidades de interacción por terminal."""


def ask_yes_no(question: str, default: bool = True) -> bool:
    suffix = " [S/n]" if default else " [s/N]"
    while True:
        answer = input(f"{question}{suffix}: ").strip().lower()
        if not answer:
            return default
        if answer in ("s", "si", "sí", "y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        print("Responde 's' o 'n'.")
