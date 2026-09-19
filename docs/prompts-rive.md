# Agente Rive

Ayúdame a crear únicamente el avatar 2D de Tess para Teams4Soft dentro de este archivo Rive.

No construyas el runtime web, no escribas React, no crees el chat, no conectes ningún modelo de IA y no generes backend.

Crea un artboard llamado Tess de 500x500 píxeles usando formas vectoriales simples. Redibuja el personaje con esta estructura:

- Body
- BodyHighlight
- LeftAntenna
- RightAntenna
- LeftEye
- RightEye
- Mouth
- LeftLeg
- RightLeg
- AccentGlow

Características visuales:

- cuerpo compacto, redondeado y ligeramente asimétrico;
- azul profundo #123B66;
- cian #34C6D8;
- coral #F47C6C como acento;
- dos antenas cortas;
- dos patas pequeñas;
- ojos blancos minimalistas;
- boca pequeña y amable;
- estilo tecnológico, profesional y limpio;
- sin texto, sin fondo, sin logotipo y sin elementos de interfaz.

Mantén el personaje reconocible en tamaños pequeños. No uses imágenes rasterizadas, partículas, audio, fuentes, filtros pesados ni efectos complejos.

Primero crea solamente el artboard y las capas vectoriales del personaje. No crees todavía las animaciones ni la State Machine.

---

# Animaciones

Ahora anima únicamente el avatar Tess que acabas de crear.

Crea estas animaciones con exactamente estos nombres:

- anim_idle
- anim_greeting
- anim_listening
- anim_thinking
- anim_speaking
- anim_success
- anim_error
- anim_reduced_motion

Comportamiento:

- anim_idle: respiración muy sutil y parpadeo ocasional.
- anim_greeting: saludo breve con movimiento pequeño de las antenas y retorno a idle.
- anim_listening: ligera inclinación hacia el usuario y brillo cian suave.
- anim_thinking: pulso lento y discreto del brillo o las antenas.
- anim_speaking: movimiento muy sutil de la boca y los ojos.
- anim_success: confirmación breve con acento cian o coral y retorno a idle.
- anim_error: pose tranquila con acento coral, sin expresión exagerada.
- anim_reduced_motion: pose casi estática, sin loops continuos.

Todas las animaciones deben ser suaves, profesionales y de baja intensidad. No añadas texto, audio, partículas, fondo ni interfaz. Mantén la misma silueta y proporciones en todos los estados.

---

# State Machine

Crea una State Machine llamada TessStateMachine para controlar las animaciones del avatar.

Incluye estos inputs públicos:

- trigger_greet
- trigger_success
- trigger_error
- is_listening
- is_thinking
- is_speaking
- prefers_reduced_motion

Reglas:

- trigger_greet reproduce anim_greeting y vuelve a idle.
- is_listening activa anim_listening.
- is_thinking activa anim_thinking.
- is_speaking activa anim_speaking.
- trigger_success reproduce anim_success y vuelve a idle.
- trigger_error reproduce anim_error y vuelve a idle.
- prefers_reduced_motion activa anim_reduced_motion y evita los loops continuos.

No crees código web ni lógica de chat. Solo configura la State Machine y deja nombres estables para que un runtime externo pueda controlarla.

---
