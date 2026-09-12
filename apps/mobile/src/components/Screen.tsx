import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeProvider'
export function Screen({title,children,back=false}:{title:string;children:React.ReactNode;back?:boolean}) {
  const t=useTheme();const insets=useSafeAreaInsets()
  return <ScrollView keyboardShouldPersistTaps="handled" style={{flex:1,backgroundColor:t.bg}} contentContainerStyle={{padding:20,paddingTop:insets.top+16,paddingBottom:180,gap:14}}>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text accessibilityRole="header" style={{fontSize:30,fontWeight:'700',color:t.text,flex:1}}>{title}</Text>{back&&<Button label="Done" onPress={()=>router.back()}/>}</View>{children}
  </ScrollView>
}
export function Label({children,muted=false}:{children:React.ReactNode;muted?:boolean}){const t=useTheme();return <Text style={{color:muted?t.textMuted:t.text,fontSize:16,lineHeight:23}}>{children}</Text>}
export function Card({children}:{children:React.ReactNode}){const t=useTheme();return <View style={{padding:16,gap:12,borderRadius:20,backgroundColor:t.bgElevated,borderWidth:1,borderColor:t.border}}>{children}</View>}
export function Button({label,onPress,disabled=false,selected=false}:{label:string;onPress:()=>void;disabled?:boolean;selected?:boolean}){const t=useTheme();return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={{minHeight:48,paddingHorizontal:14,paddingVertical:12,borderRadius:14,backgroundColor:selected?t.text:t.bgSunken,opacity:disabled?0.5:1,justifyContent:'center'}}><Text style={{color:selected?t.bg:t.text,fontSize:15,fontWeight:'600'}}>{label}</Text></Pressable>}
export function Field({label,...props}:TextInputProps&{label:string}){const t=useTheme();return <View style={{gap:4,flexGrow:1}}><Label muted>{label}</Label><TextInput accessibilityLabel={label} placeholderTextColor={t.textFaint} {...props} style={[{color:t.text,borderColor:t.border,borderWidth:1,borderRadius:12,minHeight:48,padding:12,fontSize:17},props.style]}/></View>}
export function Row({children}:{children:React.ReactNode}){return <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'center'}}>{children}</View>}
export function useAction(refresh?:()=>Promise<void>){const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function run(action:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await action();await refresh?.()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  return {run,error,busy,feedback:<>{busy&&<ActivityIndicator accessibilityLabel="Saving"/>}{!!error&&<Text accessibilityRole="alert" style={{fontSize:15}}>{error}</Text>}</>}
}
