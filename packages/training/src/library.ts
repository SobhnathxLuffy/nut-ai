import { ExerciseInput, type TrackingType } from '@nutai/core-schema'
/** Original factual taxonomy authored for Nut AI; no third-party instructions or media. */
export const EXERCISE_LIBRARY: ExerciseInput[] = []
function add(name:string, tracking_type:TrackingType, muscle:string, equipment:string[], aliases:string[] = []) {
  if (EXERCISE_LIBRARY.some(e=>e.name===name)) return
  EXERCISE_LIBRARY.push(ExerciseInput.parse({name,tracking_type,primary_muscles:[muscle],equipment,aliases}))
}
for (const [name,muscle,aliases] of [
  ['Bench Press','chest',['bench','chest press']],['Squat','quadriceps',['back squat']],['Deadlift','hamstrings',['conventional deadlift']],
  ['Overhead Press','shoulders',['ohp','military press']],['Bent Over Row','back',['barbell row']],['Romanian Deadlift','hamstrings',['rdl']],
] as const) add(`Barbell ${name}`,'weight_reps',muscle,['barbell'],[...aliases])
const lifts: [string,string,string[]][] = [
  ['Bench Press','chest',['barbell','dumbbell','machine']],['Incline Bench Press','chest',['barbell','dumbbell','machine']],
  ['Decline Bench Press','chest',['barbell','dumbbell','machine']],['Chest Fly','chest',['dumbbell','cable','machine']],
  ['Pullover','back',['dumbbell','cable','machine']],['Shoulder Press','shoulders',['barbell','dumbbell','machine']],
  ['Lateral Raise','shoulders',['dumbbell','cable','machine']],['Front Raise','shoulders',['barbell','dumbbell','cable']],
  ['Rear Delt Fly','shoulders',['dumbbell','cable','machine']],['Upright Row','shoulders',['barbell','dumbbell','cable']],
  ['Shrug','trapezius',['barbell','dumbbell','cable','machine']],['Row','back',['dumbbell','cable','machine']],
  ['Chest Supported Row','back',['dumbbell','machine']],['High Row','back',['cable','machine']],['Lat Pulldown','back',['cable','machine']],
  ['Straight Arm Pulldown','back',['cable']],['Face Pull','shoulders',['cable','band']],
  ['Biceps Curl','biceps',['barbell','dumbbell','ez_bar','cable','machine','band']],['Preacher Curl','biceps',['barbell','dumbbell','ez_bar','cable','machine']],
  ['Hammer Curl','biceps',['dumbbell','cable','band']],['Reverse Curl','forearms',['barbell','dumbbell','ez_bar','cable']],
  ['Wrist Curl','forearms',['barbell','dumbbell','cable']],['Reverse Wrist Curl','forearms',['barbell','dumbbell','cable']],
  ['Triceps Extension','triceps',['dumbbell','ez_bar','cable','machine','band']],['Overhead Triceps Extension','triceps',['dumbbell','ez_bar','cable']],
  ['Triceps Pushdown','triceps',['cable','band']],['Skull Crusher','triceps',['barbell','dumbbell','ez_bar']],
  ['Squat','quadriceps',['dumbbell','machine']],['Front Squat','quadriceps',['barbell','dumbbell','kettlebell']],
  ['Goblet Squat','quadriceps',['dumbbell','kettlebell']],['Split Squat','quadriceps',['barbell','dumbbell']],
  ['Bulgarian Split Squat','quadriceps',['barbell','dumbbell']],['Lunge','quadriceps',['barbell','dumbbell','kettlebell']],
  ['Reverse Lunge','quadriceps',['barbell','dumbbell','kettlebell']],['Lateral Lunge','quadriceps',['dumbbell','kettlebell']],
  ['Step Up','quadriceps',['barbell','dumbbell','kettlebell']],['Leg Press','quadriceps',['machine']],['Leg Extension','quadriceps',['machine']],
  ['Leg Curl','hamstrings',['machine']],['Seated Leg Curl','hamstrings',['machine']],['Romanian Deadlift','hamstrings',['dumbbell','kettlebell']],
  ['Single Leg Romanian Deadlift','hamstrings',['barbell','dumbbell','kettlebell']],['Sumo Deadlift','glutes',['barbell','dumbbell','kettlebell']],
  ['Hip Thrust','glutes',['barbell','dumbbell','machine']],['Glute Bridge','glutes',['barbell','dumbbell']],
  ['Good Morning','hamstrings',['barbell','band']],['Pull Through','glutes',['cable','band']],
  ['Hip Abduction','glutes',['cable','machine','band']],['Hip Adduction','adductors',['cable','machine','band']],
  ['Glute Kickback','glutes',['cable','machine','band']],['Standing Calf Raise','calves',['barbell','dumbbell','machine']],
  ['Seated Calf Raise','calves',['dumbbell','machine']],['Crunch','abdominals',['cable','machine']],['Wood Chop','abdominals',['cable','band']],
]
for(const [name,muscle,equipment] of lifts) for(const eq of equipment) add(`${eq==='ez_bar'?'EZ Bar':eq[0]!.toUpperCase()+eq.slice(1)} ${name}`,'weight_reps',muscle,[eq])
for(const [name,muscle] of [['Push-up','chest'],['Pull-up','back'],['Chin-up','back'],['Dip','triceps'],['Inverted Row','back'],['Pike Push-up','shoulders'],['Diamond Push-up','triceps'],['Wide Push-up','chest'],['Decline Push-up','chest'],['Incline Push-up','chest'],['Squat','quadriceps'],['Jump Squat','quadriceps'],['Split Squat','quadriceps'],['Lunge','quadriceps'],['Reverse Lunge','quadriceps'],['Step Up','quadriceps'],['Glute Bridge','glutes'],['Single Leg Glute Bridge','glutes'],['Calf Raise','calves'],['Single Leg Calf Raise','calves']] as const) add(`Bodyweight ${name}`,'bodyweight_reps',muscle,[],[name])
for(const name of ['Crunch','Reverse Crunch','Bicycle Crunch','Sit-up','Leg Raise','Hanging Knee Raise','Flutter Kick','Dead Bug','Bird Dog','Mountain Climber','Burpee','Jumping Jack','Russian Twist','Heel Touch','V-up','Hollow Rock']) add(name,'reps','abdominals',[])
for(const name of ['Plank','Side Plank','Wall Sit','Hollow Hold','Dead Hang','L-sit','Superman Hold','Glute Bridge Hold']) add(name,'time',name==='Wall Sit'?'quadriceps':'abdominals',[])
for(const name of ['Running','Walking','Cycling','Rowing','Swimming','Treadmill Running','Treadmill Walking','Stationary Cycling','Elliptical','Stair Climber','Hiking','Skipping']) add(name,'distance_time','cardio',[])
for(const eq of ['band','machine']) for(const name of ['Pull-up','Chin-up','Dip','Pistol Squat']) add(`${eq} Assisted ${name}`,'assisted','back',[eq])
for(const eq of ['dumbbell','kettlebell','trap_bar']) for(const name of ['Farmer Carry','Suitcase Carry','Front Rack Carry']) add(`${eq} ${name}`,'weight_time','forearms',[eq])
for(const name of ['Standing Long Jump','Triple Jump','Broad Jump']) add(name,'distance','quadriceps',[])
