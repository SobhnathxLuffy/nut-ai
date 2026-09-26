const fs = require('fs');
let code = fs.readFileSync('apps/mobile/src/components/DayTimeline.tsx', 'utf8');

code = code.replace(/\\nconst showAlert/g, '\nconst showAlert');
code = code.replace(/import { Alert, StyleSheet, Text, View } from 'react-native'/, "import { Alert, StyleSheet, Text, View, Platform } from 'react-native'");
code = code.replace(/import { Alert, Pressable } from 'react-native'/, "import { Alert, Pressable, Platform } from 'react-native'");

// Add Platform to imports
if (!code.includes('Platform')) {
  code = code.replace(/import \{/, 'import { Platform,');
}

fs.writeFileSync('apps/mobile/src/components/DayTimeline.tsx', code);
