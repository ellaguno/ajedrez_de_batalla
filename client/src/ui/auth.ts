import { auth, ApiError, type User } from '../api';

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const ERRORES: Record<string, string> = {
  credenciales: 'Correo o contraseña incorrectos.',
  'no-verificado': 'Tu cuenta aún no está confirmada. Revisa tu correo.',
  'email-registrado': 'Ese correo ya tiene cuenta. Usa "Entrar".',
  'demasiados-intentos': 'Demasiados intentos; espera un minuto.',
};

/** Diálogos de entrar/registrarse y perfil. Notifica cambios de usuario. */
export class AuthUI {
  private dlg = $<HTMLDialogElement>('dlg-auth');
  private dlgProfile = $<HTMLDialogElement>('dlg-profile');
  private btnUser = $<HTMLButtonElement>('btn-user');
  private form = $<HTMLFormElement>('auth-form');
  private nameInput = $<HTMLInputElement>('auth-name');
  private emailInput = $<HTMLInputElement>('auth-email');
  private passInput = $<HTMLInputElement>('auth-pass');
  private msg = $<HTMLDivElement>('auth-msg');
  private resendBtn = $<HTMLButtonElement>('auth-resend');
  private mode: 'login' | 'register' = 'login';
  user: User | null = null;

  constructor(private onChange: (user: User | null) => void) {
    this.btnUser.addEventListener('click', () => {
      if (this.user) this.dlgProfile.showModal();
      else this.open('login');
    });
    $('tab-login').addEventListener('click', () => this.setMode('login'));
    $('tab-register').addEventListener('click', () => this.setMode('register'));
    $('auth-cancel').addEventListener('click', () => this.dlg.close());
    $('profile-close').addEventListener('click', () => this.dlgProfile.close());
    $('profile-logout').addEventListener('click', () => void this.logout());
    this.resendBtn.addEventListener('click', () => void this.resend());
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
  }

  /** Restaura la sesión existente al arrancar. */
  async init(): Promise<void> {
    try {
      this.setUser((await auth.me()).user);
    } catch {
      this.setUser(null);
    }
    if (new URLSearchParams(location.search).has('verificado')) {
      history.replaceState(null, '', '/');
      this.open('login');
      this.show('¡Cuenta confirmada! Ya puedes entrar.', false);
    }
  }

  private open(mode: 'login' | 'register'): void {
    this.setMode(mode);
    this.msg.hidden = true;
    this.resendBtn.hidden = true;
    this.dlg.showModal();
  }

  private setMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    $('tab-login').classList.toggle('active', mode === 'login');
    $('tab-register').classList.toggle('active', mode === 'register');
    this.nameInput.hidden = mode === 'login';
    $('auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
    this.passInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  }

  private show(text: string, isError: boolean): void {
    this.msg.textContent = text;
    this.msg.classList.toggle('error', isError);
    this.msg.hidden = false;
  }

  private async submit(): Promise<void> {
    const email = this.emailInput.value.trim();
    const password = this.passInput.value;
    this.resendBtn.hidden = true;
    try {
      if (this.mode === 'register') {
        await auth.register(email, password, this.nameInput.value.trim() || undefined);
        this.show('Te enviamos un correo de confirmación. Ábrelo para activar tu cuenta.', false);
      } else {
        const user = await auth.login(email, password);
        this.setUser(user);
        this.dlg.close();
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'desconocido';
      this.show(ERRORES[code] ?? `Error inesperado (${code}).`, true);
      if (code === 'no-verificado') this.resendBtn.hidden = false;
    }
  }

  private async resend(): Promise<void> {
    try {
      await auth.resend(this.emailInput.value.trim(), this.passInput.value);
      this.show('Correo de confirmación reenviado.', false);
      this.resendBtn.hidden = true;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'desconocido';
      this.show(ERRORES[code] ?? `No se pudo reenviar (${code}).`, true);
    }
  }

  private async logout(): Promise<void> {
    try {
      await auth.logout();
    } catch {
      /* la sesión local se limpia igual */
    }
    this.dlgProfile.close();
    this.setUser(null);
  }

  private setUser(user: User | null): void {
    this.user = user;
    this.btnUser.textContent = user ? (user.name ?? user.email) : 'Entrar';
    $<HTMLHeadingElement>('profile-email').textContent = user
      ? `${user.name ? `${user.name} — ` : ''}${user.email}`
      : '—';
    $<HTMLButtonElement>('btn-games').hidden = !user;
    this.onChange(user);
  }
}
